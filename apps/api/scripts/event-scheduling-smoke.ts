import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DateTime} from 'luxon';
const url=process.env.CI_DATABASE_URL;
if(!url?.includes('127.0.0.1'))throw new Error('Database smoke apenas em PostgreSQL local');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=url;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {query,pool}=await import('../src/db.js');
const {previewEventDelivery,rebuildEvent,toUTC}=await import('../src/time.js');
const zone='America/Sao_Paulo';
const slug='event-custom-ci-'+crypto.randomUUID().slice(0,8);
try{
 const tenant=await query("insert into tenants(name,slug,segment,timezone) values('Custom event CI',$1,'automotive',$2) returning id",[slug,zone]);
 const tid=tenant.rows[0].id;
 const contact=await query(
  "insert into contacts(tenant_id,name,phone,consent,consent_source) values($1,'Cliente CI','+5519999999999',true,'CI test') returning id",
  [tid]
 );
 const cid=contact.rows[0].id;
 const approved=await query(
  "insert into message_templates(tenant_id,name,language_code,status,definition) values($1,'ci_event_custom','pt_BR','APPROVED','{}'::jsonb) returning id",[tid]
 );
 const templateId=approved.rows[0].id;
 await query(
  "insert into reminder_rules(tenant_id,slot,enabled,offset_value,offset_unit,send_time,template_id) values($1,1,true,1,'days','09:00',$2)",
  [tid,templateId]
 );
 await query(
  "insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,account_key,from_touchpoint) values($1,'test','test',now()+interval '1 day',$2,'99991111999911')",
  [tid,'account-'+slug]
 );
 const now=DateTime.now().setZone(zone);
 const eventLocal=now.plus({hours:2}).toFormat("yyyy-MM-dd'T'HH:mm");
 const sendLocal=now.plus({minutes:5}).toFormat("yyyy-MM-dd'T'HH:mm");
 const preview=await previewEventDelivery(tid,{
  contact_id:cid,starts_at:eventLocal,delivery_mode:'custom',
  custom_send_at:sendLocal,custom_template_id:templateId
 });
 assert.ok(preview?.can_schedule,preview?.warnings.join(' '));
 assert.equal(preview?.reminders.length,1);
 assert.equal(preview?.reminders[0].scheduled_at,toUTC(sendLocal,zone));

 const saved=await query(
  "insert into events(tenant_id,contact_id,title,starts_at,delivery_mode,custom_send_at,custom_template_id) values($1,$2,'Revisão CI',$3,'custom',$4,$5) returning id,schedule_revision",
  [tid,cid,toUTC(eventLocal,zone),toUTC(sendLocal,zone),templateId]
 );
 const id=saved.rows[0].id;
 await rebuildEvent(tid,id);
 let rows=await query('select slot,status,scheduled_at,template_id from scheduled_messages where event_id=$1',[id]);
 assert.equal(rows.rowCount,1);
 assert.equal(rows.rows[0].slot,1);
 assert.equal(rows.rows[0].status,'scheduled');
 assert.equal(rows.rows[0].template_id,templateId);
 assert.equal(rows.rows[0].scheduled_at.toISOString(),toUTC(sendLocal,zone));

 // Editing global reminder rules must not rewrite this custom notification.
 await query("update reminder_rules set offset_value=3,send_time='08:00' where tenant_id=$1 and slot=1",[tid]);
 await rebuildEvent(tid,id);
 rows=await query('select * from scheduled_messages where event_id=$1',[id]);
 assert.equal(rows.rowCount,1);
 assert.equal(rows.rows[0].scheduled_at.toISOString(),toUTC(sendLocal,zone));

 // Cancel event and ensure no pending sends remain.
 await query("update events set status='cancelled' where id=$1",[id]);
 await rebuildEvent(tid,id);
 rows=await query('select status from scheduled_messages where event_id=$1',[id]);
 assert.equal(rows.rows[0].status,'cancelled');

 // Contact must consent; a template from another tenant must be refused.
 await query('update contacts set consent=false where id=$1',[cid]);
 const blocked=await previewEventDelivery(tid,{
  contact_id:cid,starts_at:eventLocal,delivery_mode:'custom',
  custom_send_at:sendLocal,custom_template_id:templateId
 });
 assert.equal(blocked?.can_schedule,false);
 await query('update contacts set consent=true where id=$1',[cid]);
 const outsider=await query("insert into tenants(name,slug,segment) values('Other CI',$1,'clinic') returning id",[slug+'-other']);
 const foreign=await query("insert into message_templates(tenant_id,name,language_code,status,definition) values($1,'foreign','pt_BR','APPROVED','{}'::jsonb) returning id",[outsider.rows[0].id]);
 const foreignPlan=await previewEventDelivery(tid,{
  contact_id:cid,starts_at:eventLocal,delivery_mode:'custom',
  custom_send_at:sendLocal,custom_template_id:foreign.rows[0].id
 });
 assert.equal(foreignPlan?.can_schedule,false);

 const futureEvent=DateTime.now().setZone(zone).plus({days:15}).toFormat("yyyy-MM-dd'T'HH:mm");
 const automated=await query(
  "insert into events(tenant_id,contact_id,title,starts_at) values($1,$2,'Automático CI',$3) returning id,delivery_mode",
  [tid,cid,toUTC(futureEvent,zone)]
 );
 assert.equal(automated.rows[0].delivery_mode,'automation','legacy-compatible default');
 await rebuildEvent(tid,automated.rows[0].id);
 const autoQueue=await query('select slot,status from scheduled_messages where event_id=$1',[automated.rows[0].id]);
 assert.equal(autoQueue.rowCount,1);
 assert.equal(autoQueue.rows[0].status,'scheduled');
 console.log('Event scheduling: manual exact time, rules isolation, status cancellation, consent, tenant isolation and automation OK');
}finally{await pool.end()}
