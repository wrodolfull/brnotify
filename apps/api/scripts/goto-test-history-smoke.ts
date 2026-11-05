import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const db=process.env.CI_DATABASE_URL;
if(!db||!db.includes('127.0.0.1'))throw new Error('Use somente PostgreSQL local para smoke');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=db;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {listTemplateTestHistory}=await import('../src/goto-test-history.js');

try{
 const r=await query("select id from tenants where slug='teste-ci'");
 assert.equal(r.rowCount,1,'db-smoke não criou ambiente teste-ci');
 const tid=r.rows[0].id;
 const messageId=crypto.randomUUID();
 const hash='a'.repeat(64);
 await query('insert into goto_test_sends(tenant_id,recipient_hash,provider_message_id) values($1,$2,$3)',[tid,hash,messageId]);
 let history=await listTemplateTestHistory(tid);
 const first=history.find(row=>row.provider_message_id===messageId);
 assert.ok(first,'Teste não entrou no histórico');
 assert.equal(first.delivery_status,'AWAITING_DELIVERY_STATUS');
 assert.equal(first.recipient_fingerprint,hash.slice(0,12));
 const eventId=crypto.randomUUID();
 await query('insert into webhook_events(event_id,tenant_id,payload) values($1,$2,$3)',[
  eventId,tid,JSON.stringify({type:'DELIVERY_STATUS',content:{accountKey:'test',payload:{messageId,
   deliveryStatus:{description:'INVALID_DESTINATION',code:4000}}}})
 ]);
 history=await listTemplateTestHistory(tid);
 const updated=history.find(row=>row.provider_message_id===messageId);
 assert.equal(updated.delivery_status,'INVALID_DESTINATION');
 assert.equal(updated.delivery_code,'4000');
 const other=await listTemplateTestHistory(crypto.randomUUID());
 assert.deepEqual(other,[],'Histórico deve estar isolado por tenant');
 console.log('GoTo test history: aceito, falha tardia no webhook, fingerprint e isolamento OK');
}finally{await pool.end()}
