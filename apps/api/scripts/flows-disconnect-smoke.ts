import assert from 'node:assert/strict';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('Este smoke test exige PostgreSQL local de CI');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {pool,query}=await import('../src/db.js');
const {createFlow,deleteFlow}=await import('../src/automation-store.js');
const {disconnectGotoTenant}=await import('../src/goto-disconnect.js');
const {ApiOperationError}=await import('../src/external-operations.js');

const tenant=(await query("select id from tenants where slug='teste-ci'")).rows[0]?.id;
assert.ok(tenant);
const other=(await query(
 "insert into tenants(name,slug,segment) values('Outros testes de desconexão','outro-disconnect-ci','clinic') returning id"
)).rows[0].id;
const form={
 title:'Teste de exclusão isolado',trigger_type:'message.received',match_mode:'any',
 match_text:null,delay_minutes:0,check_no_new_message:false,action_type:'internal',
 action_label:'Aviso',endpoint_id:null,template_id:null,template_variables:{}
};
try{
 const created=await createFlow(tenant,form);
 const event=(await query(
  "insert into integration_events(tenant_id,source,external_key,event_type) values($1,'test','delete-flow-test','message.received') returning id",
  [tenant]
 )).rows[0];
 const run=(await query(
  "insert into automation_runs(tenant_id,flow_id,event_id,revision,due_at) values($1,$2,$3,1,now()) returning id",
  [tenant,created.id,event.id]
 )).rows[0];
 const pendingMessage=(await query(
  `insert into on_demand_messages(
    tenant_id,recipient_phone,recipient_name,consent_source,dedupe_hash,source,automation_run_id
   ) values($1,'+5519999999999','Cliente CI','Painel CI',$2,'automation',$3) returning id`,
  [tenant,'a'.repeat(64),run.id]
 )).rows[0];
 const ep=(await query(
  "select id from outbound_webhook_endpoints where tenant_id=$1 limit 1",[tenant]
 )).rows[0];
 const pendingWebhook=(await query(
  `insert into outbound_webhook_deliveries(tenant_id,endpoint_id,event_id,event_type,payload)
   values($1,$2,$3,'automation.triggered','{}'::jsonb) returning id`,
  [tenant,ep.id,run.id]
 )).rows[0];
 await assert.rejects(()=>deleteFlow(other,created.id),(e:unknown)=>
  e instanceof ApiOperationError&&e.code===404,'Other tenants must not delete flows');
 await query("update automation_runs set status='processing' where id=$1",[run.id]);
 await assert.rejects(()=>deleteFlow(tenant,created.id),(e:unknown)=>
  e instanceof ApiOperationError&&e.code===409,'Processing runs must not be deleted');
 await query("update automation_runs set status='pending' where id=$1",[run.id]);
 const removed=await deleteFlow(tenant,created.id);
 assert.equal(removed.deleted,true);
 assert.equal(removed.removed_runs,1);
 assert.equal(removed.cancelled_messages,1);
 assert.equal(removed.cancelled_webhooks,1);
 assert.equal((await query('select count(*)::int n from automation_flows where id=$1',[created.id])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from automation_runs where id=$1',[run.id])).rows[0].n,0);
 assert.equal((await query('select status from on_demand_messages where id=$1',[pendingMessage.id])).rows[0].status,'cancelled');
 assert.equal((await query('select status from outbound_webhook_deliveries where id=$1',[pendingWebhook.id])).rows[0].status,'dead');

 await query(
  `insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,account_key,from_touchpoint,call_scopes_granted)
   values($1,'api-secret','refresh-secret',now()+interval '1 day','123456789012','137169456416846',true)
   on conflict(tenant_id) do update set access_token_enc='api-secret',refresh_token_enc='refresh-secret',
    expires_at=excluded.expires_at,account_key=excluded.account_key,from_touchpoint=excluded.from_touchpoint,call_scopes_granted=true`,
  [tenant]
 );
 await query(
  `insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,account_key)
   values($1,'other-api-secret','other-refresh',now()+interval '1 day','888888888888')`,
  [other]
 );
 await query(
  `insert into goto_call_monitors(tenant_id,webhook_secret_hash,enabled)
   values($1,$2,true) on conflict(tenant_id) do update set enabled=true`,
  [tenant,'b'.repeat(64)]
 );
 const runningFlow=await createFlow(tenant,{...form,title:'Fluxo da GoTo em operação'});
 await query("update automation_flows set status='active' where id=$1",[runningFlow.id]);
 const originalEvent=(await query("select id from events where tenant_id=$1 limit 1",[tenant])).rows[0];
 assert.ok(originalEvent);
 const reminder=(await query(
  `insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,schedule_revision)
   values($1,$2,3,now()+interval '1 day',99) returning id`,[tenant,originalEvent.id]
 )).rows[0];
 const direct=(await query(
  `insert into on_demand_messages(tenant_id,recipient_phone,recipient_name,consent_source,dedupe_hash,source)
   values($1,'+5519999999999','Cliente CI','Painel CI',$2,'panel') returning id`,
  [tenant,'c'.repeat(64)]
 )).rows[0];
 await query("update on_demand_messages set status='processing' where id=$1",[direct.id]);
 await assert.rejects(()=>disconnectGotoTenant(tenant,'00000000-0000-4000-8000-000000000001'),(e:unknown)=>
  e instanceof ApiOperationError&&e.code===409,'In-flight sends must block disconnect');
 await query("update on_demand_messages set status='queued' where id=$1",[direct.id]);
 // Add a real local auth.users actor so the audit FK matches.
 const user=(await query(
  "insert into auth.users(id,email) values(gen_random_uuid(),'disconnect-ci@example.com') returning id"
 )).rows[0].id;
 const result=await disconnectGotoTenant(tenant,user);
 assert.equal(result.disconnected,true);
 assert.equal(result.provider_authorization_revoked,false);
 assert.ok(result.cancelled_direct>=1&&result.cancelled_reminders>=1);
 assert.equal((await query('select count(*)::int n from goto_connections where tenant_id=$1',[tenant])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from goto_connections where tenant_id=$1',[other])).rows[0].n,1);
 assert.equal((await query('select count(*)::int n from goto_call_monitors where tenant_id=$1',[tenant])).rows[0].n,0);
 assert.equal((await query('select status from automation_flows where id=$1',[runningFlow.id])).rows[0].status,'paused');
 assert.equal((await query('select status from scheduled_messages where id=$1',[reminder.id])).rows[0].status,'cancelled');
 assert.equal((await query('select status from on_demand_messages where id=$1',[direct.id])).rows[0].status,'cancelled');
 assert.equal((await query("select count(*)::int n from audit_logs where tenant_id=$1 and action='goto.disconnected'",[tenant])).rows[0].n,1);
 console.log('Flow deletion and tenant GoTo disconnect: isolation, pending cancellations, processing safety and audit passed');
}finally{await pool.end()}
