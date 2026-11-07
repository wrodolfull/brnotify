import assert from 'node:assert/strict';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('Teste exige PostgreSQL local do CI');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {pool,query}=await import('../src/db.js');
const {extractGotoReportSignals}=await import('../src/goto-report-intelligence.js');
const {createFlow,setFlowStatus,listRuns}=await import('../src/automation-store.js');
const {recordGotoEvent,listGoToEvents}=await import('../src/goto-event-store.js');
const {scanAutomationEvents,processAutomationRun}=await import('../src/automation-worker.js');
const tenant=(await query("select id from tenants where slug='teste-ci'")).rows[0]?.id;
assert.ok(tenant);
const account='123456789012';
const base={
 title:'Oportunidade detectada',trigger_type:'call.ai.insight.detected',
 match_mode:'equals',match_text:'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED',
 delay_minutes:0,check_no_new_message:false,action_type:'internal',
 action_label:'Avisar o comercial',endpoint_id:null,template_id:null,template_variables:{}
};
function intelligence(conversationSpaceId:string,code:string,ref:string){
 return {accountKey:account,conversationSpaceId,callEnded:new Date().toISOString(),
  direction:'INBOUND',actions:[{type:code,transcriptId:ref,notes:'PRIVATE-DO-NOT-STORE'}]};
}
try{
 await query(`insert into goto_call_monitors(tenant_id,webhook_secret_hash,enabled,
    state_subscribed,report_revision_subscription_id)
   values($1,repeat('0',64),true,true,'subscription-ci')
   on conflict(tenant_id) do update set enabled=true,
    report_revision_subscription_id='subscription-ci'`,[tenant]);
 const flow=await createFlow(tenant,base);
 const first=extractGotoReportSignals(intelligence('call-ai-before','AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED','trans-before'))[0];
 await recordGotoEvent(tenant,first.event,account);
 await setFlowStatus(tenant,flow.id,'active');
 await scanAutomationEvents();
 assert.equal((await query('select count(*)::int n from automation_runs where flow_id=$1',[flow.id])).rows[0].n,0);
 const after=extractGotoReportSignals(intelligence('call-ai-after','AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED','trans-after'))[0];
 assert.equal((await recordGotoEvent(tenant,after.event,account)).inserted,true);
 assert.equal((await recordGotoEvent(tenant,after.event,account)).inserted,false);
 const unrelated=extractGotoReportSignals(intelligence('call-ai-other','AI_INSIGHT_SALE_CLOSE_DETECTED','trans-other'))[0];
 await recordGotoEvent(tenant,unrelated.event,account);
 await scanAutomationEvents();
 await scanAutomationEvents();
 assert.equal((await query('select count(*)::int n from automation_runs where flow_id=$1',[flow.id])).rows[0].n,1);
 assert.equal(await processAutomationRun(),1);
 const completed=await query('select status,result from automation_runs where flow_id=$1',[flow.id]);
 assert.equal(completed.rows[0].status,'completed');
 assert.equal(completed.rows[0].result.kind,'internal');
 const voicemailFlow=await createFlow(tenant,{
  ...base,title:'Recado de voz',trigger_type:'call.voicemail.new',
  match_mode:'any',match_text:null,action_label:'Novo recado para revisão'
 });
 await setFlowStatus(tenant,voicemailFlow.id,'active');
 const message={accountKey:account,conversationSpaceId:'call-voicemail',
  callEnded:new Date().toISOString(),direction:'INBOUND',
  actions:[{type:'VOICEMAIL_NEW',voicemailId:'voice-ci',durationMs:5600}]};
 const voicemail=extractGotoReportSignals(message)[0];
 await recordGotoEvent(tenant,voicemail.event,account);
 await recordGotoEvent(tenant,voicemail.event,account);
 await scanAutomationEvents();
 assert.equal((await query('select count(*)::int n from automation_runs where flow_id=$1',[voicemailFlow.id])).rows[0].n,1);
 assert.equal(await processAutomationRun(),1);
 const events=await listGoToEvents(tenant,1,'intelligence');
 assert.ok(events.items.some((e:any)=>e.metadata.signal_code==='VOICEMAIL_NEW'));
 assert.ok(events.items.some((e:any)=>e.metadata.signal_code==='AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED'));
 assert.ok(!JSON.stringify(events).includes('PRIVATE-DO-NOT-STORE'));
 const other=await listGoToEvents('00000000-0000-4000-8000-000000000000',1,'intelligence');
 assert.equal(other.total,0);
 const endpoint=await query(
  "select id from outbound_webhook_endpoints where tenant_id=$1 and active=true limit 1",[tenant]
 );
 assert.ok(endpoint.rowCount);
 const crmFlow=await createFlow(tenant,{
  ...base,title:'Enviar insight ao CRM',match_mode:'any',match_text:null,
  action_type:'webhook',action_label:'Notificar CRM',endpoint_id:endpoint.rows[0].id
 });
 await setFlowStatus(tenant,crmFlow.id,'active');
 const commercial=extractGotoReportSignals(intelligence(
  'call-ai-webhook','AI_INSIGHT_SALE_CLOSE_DETECTED','trans-webhook'
 ))[0];
 await recordGotoEvent(tenant,commercial.event,account);
 await scanAutomationEvents();
 for(let i=0;i<5;i++)if(!(await processAutomationRun()))break;
 const webhook=await query(
  `select d.payload,d.status from outbound_webhook_deliveries d
   join automation_runs r on d.event_id=r.id
   where r.tenant_id=$1 and r.flow_id=$2`,[tenant,crmFlow.id]
 );
 assert.equal(webhook.rowCount,1);
 assert.equal(webhook.rows[0].status,'queued');
 assert.equal(webhook.rows[0].payload.data.signal_code,'AI_INSIGHT_SALE_CLOSE_DETECTED');
 const original=await query(
  "insert into goto_call_conversations(tenant_id,conversation_space_id,report_status) values($1,'test-revision-report','complete') returning id",
  [tenant]
 );
 const revision={
  source:'call-events-report',externalKey:'test-revision-report:REPORT_SUMMARY_REVISION:unique',
  type:'call.report.available',conversationId:'test-revision-report',occurredAt:new Date().toISOString(),
  direction:null,stateType:null,sequence:null,accountKey:account,
  metadata:{report_type:'REPORT_SUMMARY_REVISION'}
 };
 await recordGotoEvent(tenant,revision,account);
 const pending=await query('select report_status from goto_call_conversations where id=$1',[original.rows[0].id]);
 assert.equal(pending.rows[0].report_status,'pending','Late revisions must schedule a fresh report fetch');
 const runs=await listRuns(tenant,1,flow.id);
 assert.equal(runs.total,1);
 console.log('Etapa 3 validada: insights seguros, voicemail, filtro, dedupe, revisões, isolamento e automações.');
}finally{await pool.end()}
