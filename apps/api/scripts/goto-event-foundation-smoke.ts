import assert from 'node:assert/strict';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('Teste exige banco PostgreSQL local do CI');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {pool,query}=await import('../src/db.js');
const {normalizeGotoEvent}=await import('../src/goto-event-normalizer.js');
const {recordGotoEvent,listGoToEvents,listGoToCalls}=await import('../src/goto-event-store.js');
const {summarizeCallReport}=await import('../src/goto-call-report-worker.js');

const tenant=(await query("select id from tenants where slug='teste-ci'")).rows[0]?.id;
assert.ok(tenant);
const other=(await query("insert into tenants(name,slug,segment) values('Outro ambiente','outro-call-ci','clinic') returning id")).rows[0].id;
const conv='91be7aab-5856-485c-8823-60dd9924143f';
const accountKey='123456789012';
function call(seq:number,type:'STARTING'|'ACTIVE'|'ENDING'){
 return normalizeGotoEvent({source:'call-events',type:'call-state',
  timestamp:'2026-11-07T12:00:00Z',
  content:{metadata:{conversationSpaceId:conv,accountKey,direction:'INBOUND'},
   state:{id:'state-'+seq,sequenceNumber:seq,type,timestamp:'2026-11-07T12:00:00Z',participants:[]}}})!;
}
try{
 const first=await recordGotoEvent(tenant,call(1,'STARTING'),accountKey);
 assert.equal(first.inserted,true);
 const duplicate=await recordGotoEvent(tenant,call(1,'STARTING'),accountKey);
 assert.equal(duplicate.inserted,false);
 const later=await recordGotoEvent(tenant,call(3,'ENDING'),accountKey);
 assert.equal(later.inserted,true);
 await recordGotoEvent(tenant,call(2,'ACTIVE'),accountKey);
 const calls=await listGoToCalls(tenant,1);
 assert.equal(calls.total,1);
 assert.equal(calls.items[0].last_state,'ENDING','An out-of-order ACTIVE must not replace ENDING');
 assert.equal(calls.items[0].last_sequence,undefined,'Internal sequence not returned to the UI');
 assert.equal(calls.items[0].sequence_gap,true,'Detected gaps remain explicit for reconciliation');
 const wrong=call(4,'ENDING');
 await assert.rejects(()=>recordGotoEvent(tenant,wrong,'999999999999'),/outra conta/);
 const notification=normalizeGotoEvent({data:{
  source:'call-events-report',type:'REPORT_SUMMARY',timestamp:'2026-11-07T12:10:00Z',
  content:{conversationSpaceId:conv}
 }})!;
 await recordGotoEvent(tenant,notification,accountKey);
 await recordGotoEvent(tenant,notification,accountKey);
 const found=await query(
  'select report_status,report_attempts from goto_call_conversations where tenant_id=$1 and conversation_space_id=$2',
  [tenant,conv]
 );
 assert.equal(found.rows[0].report_status,'pending');
 assert.equal(found.rows[0].report_attempts,0);
 await recordGotoEvent(tenant,{
  ...notification,externalKey:conv+':report-ready',type:'call.report.ready'
 },accountKey);
 const noRequeue=await query(
  'select count(*)::int n from integration_events where tenant_id=$1 and conversation_space_id=$2',
  [tenant,conv]
 );
 assert.equal(noRequeue.rows[0].n,5);
 const events=await listGoToEvents(tenant,1,'call');
 assert.equal(events.total,5);
 assert.equal((await listGoToCalls(other,1)).total,0,'No cross-tenant call leakage');
 assert.equal((await listGoToEvents(other,1,'all')).total,0);
 const summarized=summarizeCallReport({accountKey,conversationSpaceId:conv,
  direction:'INBOUND',participants:[{type:{value:'PHONE_NUMBER',number:'+5511999999999'}}]});
 assert.equal(summarized.external_number,'+5511999999999');
 assert.equal(summarized.classification,'not_classified');
 console.log('GoTo event foundation: dedupe, order, report queue and tenant isolation validated');
}finally{await pool.end()}
