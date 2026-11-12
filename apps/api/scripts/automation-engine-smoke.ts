import assert from 'node:assert/strict';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('CI PostgreSQL local necessário');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {pool,query}=await import('../src/db.js');
const {createFlow,setFlowStatus,updateFlow,listRuns}=await import('../src/automation-store.js');
const {scanAutomationEvents,processAutomationRun}=await import('../src/automation-worker.js');
const {recordGotoEvent}=await import('../src/goto-event-store.js');
const tenant=(await query("select id from tenants where slug='teste-ci'")).rows[0]?.id;
assert.ok(tenant);
const account='123456789012';
const now=()=>new Date().toISOString();
const base={
 title:'Resposta WhatsApp',trigger_type:'message.received',match_mode:'equals',match_text:'2',
 delay_minutes:0,check_no_new_message:false,action_type:'internal',
 action_label:'Cliente solicitou reagendamento',endpoint_id:null,template_id:null,template_variables:{}
};
async function received(key:string,text:string,phone='+5519999999999'){
 return recordGotoEvent(tenant,{
  source:'inbox-notification',externalKey:key,type:'message.received',conversationId:null,
  occurredAt:now(),direction:null,stateType:null,sequence:null,accountKey:account,
  metadata:{channel:'WHATSAPP',phone,text}
 },account);
}
try{
 const flow=await createFlow(tenant,base);
 assert.equal(flow.status,'draft');
 await received('before-activation','2');
 const active=await setFlowStatus(tenant,flow.id,'active');
 assert.equal(active.status,'active');
 await scanAutomationEvents();
 assert.equal((await query('select count(*)::int n from automation_runs where flow_id=$1',[flow.id])).rows[0].n,0,
  'No backfill of events predating activation');
 const created=await received('automated-reply-1','2');
 assert.equal(created.inserted,true);
 const dup=await received('automated-reply-1','2');
 assert.equal(dup.inserted,false);
 await received('automated-reply-2','3');
 await scanAutomationEvents();
 await scanAutomationEvents();
 const runCount=await query('select count(*)::int n from automation_runs where flow_id=$1',[flow.id]);
 assert.equal(runCount.rows[0].n,1,'Identical events or unmatched text must not create duplicate runs');
 assert.equal(await processAutomationRun(),1);
 const run=await query('select status,result from automation_runs where flow_id=$1',[flow.id]);
 assert.equal(run.rows[0].status,'completed');
 assert.equal(run.rows[0].result.kind,'internal');
 const paused=await setFlowStatus(tenant,flow.id,'paused');
 assert.equal(paused.status,'paused');
 const updated=await updateFlow(tenant,flow.id,{...base,action_label:'Avisar supervisão'});
 assert.equal(updated.action_label,'Avisar supervisão');
 await received('after-pause','2');
 await scanAutomationEvents();
 assert.equal((await query('select count(*)::int n from automation_runs where flow_id=$1',[flow.id])).rows[0].n,1);
 const delayed=await createFlow(tenant,{
  ...base,title:'Sem nova resposta',match_mode:'any',match_text:null,
  delay_minutes:1,check_no_new_message:true
 });
 await setFlowStatus(tenant,delayed.id,'active');
 await received('pending-client-reply','Primeiro texto');
 await scanAutomationEvents();
 await recordGotoEvent(tenant,{
  source:'inbox-notification',externalKey:'later-client-reply',type:'message.received',
  conversationId:null,occurredAt:new Date(Date.now()+2000).toISOString(),
  direction:null,stateType:null,sequence:null,accountKey:account,
  metadata:{channel:'WHATSAPP',phone:'+5519999999999',text:'Nova resposta'}
 },account);
 await scanAutomationEvents();
 await query(
  `update automation_runs set due_at=now()-interval '1 second'
   where flow_id=$1 and event_id in(select id from integration_events where external_key='pending-client-reply' and tenant_id=$2)`,
  [delayed.id,tenant]
 );
 assert.equal(await processAutomationRun(),1);
 const oldRun=await query(
  `select r.status,r.reason from automation_runs r join integration_events e on e.id=r.event_id
   where r.flow_id=$1 and e.external_key='pending-client-reply'`,[delayed.id]
 );
 assert.equal(oldRun.rows[0].status,'skipped','A newer customer reply suppresses the waiting action');
 await setFlowStatus(tenant,delayed.id,'paused');
 const webhookEndpoint=await query(
  "insert into outbound_webhook_endpoints(tenant_id,label,destination_url,signing_secret_enc,event_types) values($1,'CRM CI','https://example.com/hooks','encrypted-test',array['appointment.confirmed']) returning id",
  [tenant]
 );
 const hook=await createFlow(tenant,{
  ...base,title:'Webhook de resposta',match_mode:'any',match_text:null,
  action_type:'webhook',action_label:'Avisar sistema externo',endpoint_id:webhookEndpoint.rows[0].id
 });
 await setFlowStatus(tenant,hook.id,'active');
 await received('hook-event','Confirmar');
 await scanAutomationEvents();
 assert.equal(await processAutomationRun(),1);
 const hookRun=await query('select id,status,result from automation_runs where flow_id=$1',[hook.id]);
 assert.equal(hookRun.rows[0].status,'completed');
 assert.equal(hookRun.rows[0].result.delivery,'queued');
 const delivery=await query(
  'select status,event_type from outbound_webhook_deliveries where tenant_id=$1 and event_id=$2',
  [tenant,hookRun.rows[0].id]
 );
 assert.equal(delivery.rows[0].status,'queued');
 assert.equal(delivery.rows[0].event_type,'automation.triggered');
 const template=(await query("select id from message_templates where tenant_id=$1 and status='APPROVED' and name='continuar_whatsapp' limit 1",[tenant])).rows[0]?.id;
 assert.ok(template);
 const whatsapp=await createFlow(tenant,{
  ...base,title:'Resposta por template',match_mode:'any',match_text:null,
  action_type:'whatsapp',action_label:'Confirmar recebimento',template_id:template
 });
 await setFlowStatus(tenant,whatsapp.id,'active');
 await received('wa-trigger','Olá');
 await scanAutomationEvents();
 // The webhook flow also runs on this event; both are intentionally independent.
 for(let i=0;i<4;i++)if(!(await processAutomationRun()))break;
 const send=await query(
  `select m.source,m.automation_run_id,r.status as run_status
   from on_demand_messages m join automation_runs r on r.id=m.automation_run_id
   where r.flow_id=$1`,[whatsapp.id]
 );
 assert.equal(send.rowCount,1);
 assert.equal(send.rows[0].source,'automation');
 assert.equal(send.rows[0].run_status,'completed');
 // Real IVR sends are already in on_demand_messages (source='ivr'), not goto_test_sends.
 // A matching response must trigger its origin-template flow, and competing sends must be skipped.
 const ivrPhone='+5511991234567';
 const ivrFlow=await createFlow(tenant,{...base,title:'URA: opção 2',
  source_template_id:template,action_type:'internal',action_label:'Opção 2 recebida'});
 await setFlowStatus(tenant,ivrFlow.id,'active');
 await query(`insert into on_demand_messages(
  tenant_id,template_id,recipient_phone,recipient_name,consent_source,dedupe_hash,
  status,source,provider_message_id,sent_at
 ) values($1,$2,$3,'Teste URA','ivr_option_whatsapp',$4,'sent','ivr',$5,now()-interval '15 seconds')`,
 [tenant,template,ivrPhone,'a'.repeat(64),'provider-ivr-1']);
 await received('ivr-response-single','2',ivrPhone);
 await scanAutomationEvents();
 const ivrResult=await query('select status from automation_runs where tenant_id=$1 and flow_id=$2',
  [tenant,ivrFlow.id]);
 assert.equal(ivrResult.rowCount,1,'The IVR template response should produce one run');
 assert.equal(ivrResult.rows[0].status,'pending');
 await query(`insert into on_demand_messages(
  tenant_id,template_id,recipient_phone,recipient_name,consent_source,dedupe_hash,
  status,source,provider_message_id,sent_at
 ) values($1,$2,$3,'Teste URA','ivr_option_whatsapp',$4,'sent','ivr',$5,now()-interval '5 seconds')`,
 [tenant,template,ivrPhone,'b'.repeat(64),'provider-ivr-2']);
 await received('ivr-response-ambiguous','2',ivrPhone);
 await scanAutomationEvents();
 const ignored=await query(
  `select status,reason from automation_runs r join integration_events e on e.id=r.event_id
    where r.flow_id=$1 and e.external_key='ivr-response-ambiguous'`,[ivrFlow.id]);
 assert.equal(ignored.rows[0]?.status,'skipped','Ambiguous IVR template replies must not enqueue WhatsApp');
 assert.match(ignored.rows[0]?.reason||'',/único envio/);
 const unrelated=await listRuns('00000000-0000-4000-8000-000000000000',1,null);
 assert.equal(unrelated.total,0);
 console.log('Automações: sem backfill, idempotência, filtro, histórico, webhook assinado e WhatsApp autorizado');
}finally{await pool.end()}
