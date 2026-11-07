import assert from 'node:assert/strict';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw Error('Teste precisa usar PostgreSQL local do CI');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {enqueuePanelNotification,panelHistory}=await import('../src/panel-notifications.js');
try{
 const tenant=await query("select id from tenants where slug='teste-ci'");
 assert.equal(tenant.rowCount,1);
 const tenantId=tenant.rows[0].id;
 const contact=await query("select id from contacts where tenant_id=$1 and phone='+5519999999999'",[tenantId]);
 const template=await query("select id from message_templates where tenant_id=$1 and name='continuar_whatsapp'",[tenantId]);
 assert.equal(contact.rowCount,1);
 assert.equal(template.rowCount,1);
 const scheduledAt=new Date(Date.now()+4*86400000).toISOString();
 const payload={contact_id:contact.rows[0].id,template_id:template.rows[0].id,
  scheduled_at:scheduledAt,variables:{}};
 const first=await enqueuePanelNotification(tenantId,payload);
 assert.equal(first.status,'queued');
 assert.equal(first.deduplicated,false);
 const second=await enqueuePanelNotification(tenantId,payload);
 assert.equal(second.deduplicated,true);
 assert.equal(second.id,first.id);
 const stored=await query('select source,api_key_id,next_attempt_at,scheduled_for,expires_at from on_demand_messages where id=$1',[first.id]);
 assert.equal(stored.rows[0].source,'panel');
 assert.equal(stored.rows[0].api_key_id,null);
 assert.ok(new Date(stored.rows[0].next_attempt_at).getTime()>Date.now()+3*86400000);
 assert.ok(new Date(stored.rows[0].expires_at).getTime()>new Date(stored.rows[0].scheduled_for).getTime());
 const history=await panelHistory(tenantId,1,'queued');
 assert.ok(history.items.some((x:any)=>x.id===first.id));
 const other=await panelHistory('00000000-0000-4000-8000-000000000000',1,null);
 assert.equal(other.items.length,0);
 const optedOut=await query("select id from contacts where tenant_id=$1 and opted_out_at is not null limit 1",[tenantId]);
 assert.equal(optedOut.rowCount,1);
 await assert.rejects(()=>enqueuePanelNotification(tenantId,{...payload,contact_id:optedOut.rows[0].id}),/consentimento|descadastrado/);
 const events=await query('select count(*)::int n from events where tenant_id=$1',[tenantId]);
 assert.ok(events.rows[0].n>=1,'Agendamentos originais preservados');
 console.log('Envio de painel: agendamento sem evento, deduplicação, autorização, tenant e histórico validados');
}finally{await pool.end()}
