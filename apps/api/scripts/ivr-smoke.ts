import assert from 'node:assert/strict';
import crypto from 'node:crypto';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))throw Error('CI local PostgreSQL obrigatório');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {query,pool}=await import('../src/db.js');
const {enqueueOnDemandMessage,getOnDemandMessage}=await import('../src/on-demand-queue.js');
const {claimNextOnDemandMessage}=await import('../src/on-demand-worker.js');
const {hasScope}=await import('../src/integration-keys.js');
try{
 const t=await query("select id from tenants where slug='teste-ci'");
 assert.ok(t.rowCount);
 const tenant=t.rows[0].id;
 const template=await query(
  "insert into message_templates(tenant_id,name,language_code,status,definition) values($1,'continuar_whatsapp','pt_BR','APPROVED',$2) returning id",
  [tenant,JSON.stringify({components:[{type:'body',components:[{type:'text',attributes:{text:'Olá, este é seu atendimento.'}}]}]})]
 );
 await query(
  "insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,account_key,from_touchpoint) values($1,'encrypted','encrypted',now()+interval '1 hour','test-goto-account','test-meta-phone')",
  [tenant]
 );
 const key=await query(
  "insert into integration_api_keys(tenant_id,label,token_prefix,token_hash,scopes,expires_at) values($1,'URA CI','brn_live_ci','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',ARRAY['messages:send'],now()+interval '1 day') returning id",
  [tenant]
 );
 assert.equal(hasScope(['messages:send'],'messages:send'),true);
 assert.equal(hasScope(['messages:send'],'events:write'),false);
 const payload={to:'19988887777',template:'continuar_whatsapp',consent:{confirmed:true,source:'ivr_option_whatsapp'}};
 const a=await enqueueOnDemandMessage(tenant,key.rows[0].id,payload);
 assert.equal(a.status,'queued');
 assert.equal(a.deduplicated,false);
 const repeated=await enqueueOnDemandMessage(tenant,key.rows[0].id,payload);
 assert.equal(repeated.deduplicated,true);
 assert.equal(repeated.id,a.id);
 const same=await query('select count(*)::int n from on_demand_messages where tenant_id=$1',[tenant]);
 assert.equal(same.rows[0].n,1);
 const contact=await query('select consent,consent_source from contacts where tenant_id=$1 and phone=$2',[tenant,'+5519988887777']);
 assert.equal(contact.rows[0].consent,true);
 assert.equal(contact.rows[0].consent_source,'ivr_option_whatsapp');
 const allowed=await getOnDemandMessage(tenant,key.rows[0].id,a.id);
 assert.equal(allowed.id,a.id);
 assert.equal(await getOnDemandMessage(tenant,crypto.randomUUID(),a.id),null);
 const claims=await Promise.all([claimNextOnDemandMessage(),claimNextOnDemandMessage()]);
 assert.equal(claims.filter(Boolean).length,1,'Concorrência em duas instâncias duplicou uma reserva');
 assert.equal(claims.find(Boolean)?.id,a.id);
 await query("update on_demand_messages set status='sent',locked_at=null where id=$1",[a.id]);
 // Existing opt-out must never be reactivated by IVR-provided consent=true.
 await query("update contacts set consent=false,opted_out_at=now() where tenant_id=$1 and phone=$2",[tenant,'+5519988887777']);
 await assert.rejects(()=>enqueueOnDemandMessage(tenant,key.rows[0].id,{...payload,name:'Outro nome'}),/opt-out/);
 console.log('IVR on-demand: token scope, 2m dedupe, consent, opt-out, tenant isolation and parallel claims approved');
}finally{await pool.end()}
