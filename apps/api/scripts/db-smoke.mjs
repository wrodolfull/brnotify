import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';

if(process.env.NODE_ENV==='production')throw new Error('Testes de banco não podem rodar em produção');
if(!process.env.CI_DATABASE_URL || !process.env.CI_DATABASE_URL.includes('127.0.0.1'))
 throw new Error('CI_DATABASE_URL deve apontar para PostgreSQL local de testes');

const client=new pg.Client({connectionString:process.env.CI_DATABASE_URL});
await client.connect();
try{
 await client.query('create schema if not exists auth');
 await client.query('create table if not exists auth.users(id uuid primary key, email text)');
 await client.query("do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end$$");
 for(const path of [
  'database/001_init.sql','database/002_rebuild_queue.sql',
  'database/003_public_integrations.sql','database/004_unified_reports.sql','database/005_goto_rich_templates.sql',
  'database/006_safe_message_dispatch.sql','database/007_ivr_on_demand.sql','database/008_event_custom_scheduling.sql','database/009_ivr_key_no_expiration.sql','database/010_panel_notifications.sql'
 ]){
  await client.query(await fs.readFile(path,'utf8'));
  console.log('Migração SQL aprovada:',path);
 }
 const schema=await client.query(
  "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('tenants','events','integration_api_keys','outbound_webhook_endpoints','outbound_webhook_deliveries','inbound_interactions')"
 );
 assert.equal(schema.rows[0].n,6,'Tabelas de integração ausentes');
 const tenant=await client.query("insert into tenants(name,slug,segment) values('Teste','teste-ci','automotive') returning id");
 const tenantId=tenant.rows[0].id;
 const contact=await client.query("insert into contacts(tenant_id,name,phone,consent,consent_source) values($1,'Teste','+5519999999999',true,'Teste') returning id",[tenantId]);
 const event=await client.query(
  "insert into events(tenant_id,contact_id,title,starts_at,confirmation_enabled,confirmation_status,external_id) values($1,$2,'Revisão',now()+interval '30 days',true,'pending','REV-CI-1') returning id",
  [tenantId,contact.rows[0].id]
 );
 await client.query(
  "insert into outbound_webhook_endpoints(tenant_id,label,destination_url,signing_secret_enc,event_types) values($1,'CRM','https://crm.example.com/hooks','encrypted-test',array['reminder.sent','appointment.confirmed'])",
  [tenantId]
 );
 const msg=await client.query(
  "insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,schedule_revision) values($1,$2,1,now()+interval '1 day',1) returning id",
  [tenantId,event.rows[0].id]
 );
 await client.query("update scheduled_messages set status='sent',sent_at=now() where id=$1",[msg.rows[0].id]);
 await client.query("update events set confirmation_status='confirmed',confirmation_received_at=now() where id=$1",[event.rows[0].id]);
 const queued=await client.query("select event_type from outbound_webhook_deliveries where tenant_id=$1 order by event_type",[tenantId]);
 assert.deepEqual(queued.rows.map(x=>x.event_type),['appointment.confirmed','reminder.sent']);
 console.log('Outbox transacional: estados confirmados para mensagem e evento');

 await client.query('begin');
 await client.query('set local role anon');
 try{
  await client.query('select * from integration_api_keys limit 1');
  throw new Error('anon conseguiu consultar chaves de API');
 }catch(e){
  if(e.message.includes('conseguiu'))throw e;
  assert.match(e.message,/permission denied/);
 }
 await client.query('rollback');
 console.log('Permissões de tabelas privadas: bloqueadas para anon');

 // Não é possível testar segredos de produção, OAuth GoTo ou webhooks HTTPS externos aqui.
}finally{
 await client.end();
}
