import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DateTime} from 'luxon';

if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('Testes de integração apenas com PostgreSQL local de CI');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {strictAppointmentSyncSchema,saveReminder,ApiOperationError}=await import('../src/external-operations.js');
const tenantSlug='sync-ci-'+crypto.randomUUID().slice(0,8);
const zone='America/Sao_Paulo';
const date=DateTime.now().setZone(zone).plus({days:40}).toISODate()!;
const nextDate=DateTime.now().setZone(zone).plus({days:41}).toISODate()!;
const phone='+5519999999999';
const appointment={
 external_id:'SYNC-CI-CLINIC-1',
 contact:{external_id:'PATIENT-CI-1',name:'Mariana Lima',phone,consent:true,consent_source:'Agendamento com aceite'},
 event:{title:'Consulta de retorno',type:'consulta',date,time:'14:30',timezone:zone,confirmation_enabled:true},
 reminders:[{before:1,unit:'days' as const,send_time:'09:00'}]
};
let tenantId='';
try{
 const t=await query(
  "insert into tenants(name,slug,segment,timezone) values('Integração CI',$1,'clinic',$2) returning id",
  [tenantSlug,zone]
 );
 tenantId=t.rows[0].id;
 assert.throws(()=>strictAppointmentSyncSchema.parse({
  ...appointment,event:{title:'Consulta',date}
 }),/ZodError|invalid/i,'Horário não pode ser implícito');
 assert.throws(()=>strictAppointmentSyncSchema.parse({
  ...appointment,contact:{name:'Mariana Lima',phone}
 }),/ZodError|invalid/i,'Consentimento e origem devem ser obrigatórios');

 // Without rules, saving a contact + event must NOT pretend a notification was scheduled.
 const parsed=strictAppointmentSyncSchema.parse(appointment);
 await assert.rejects(()=>saveReminder(tenantId,parsed,{requireDispatchReady:true}),
  (e:unknown)=>e instanceof ApiOperationError&&e.code===409&&/regra/.test(e.message));
 const uncommitted=await query('select count(*)::int n from contacts where tenant_id=$1',[tenantId]);
 assert.equal(uncommitted.rows[0].n,0,'Contato persistido apesar de falha de agenda');

 await query(
  "insert into reminder_rules(tenant_id,slot,enabled,offset_value,offset_unit,send_time) values($1,1,true,1,'days','09:00')",
  [tenantId]
 );
 await assert.rejects(()=>saveReminder(tenantId,parsed,{requireDispatchReady:true}),
  (e:unknown)=>e instanceof ApiOperationError&&e.code===409&&/template/.test(e.message));

 const model=await query(
  "insert into message_templates(tenant_id,name,language_code,status,definition) values($1,'consulta_clinica','pt_BR','APPROVED',$2) returning id",
  [tenantId,JSON.stringify({components:[{type:'body',text:'Lembrete de consulta'}]})]
 );
 await query('update reminder_rules set template_id=$2 where tenant_id=$1 and slot=1',[tenantId,model.rows[0].id]);
 await assert.rejects(()=>saveReminder(tenantId,parsed,{requireDispatchReady:true}),
  (e:unknown)=>e instanceof ApiOperationError&&e.code===409&&/GoTo/.test(e.message));

 await query(
  "insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,account_key,from_touchpoint) values($1,'ci-encrypted','ci-encrypted',now()+interval '1 hour',$2,'ci-meta-phone')",
  [tenantId,'ci-account-'+tenantSlug]
 );
 const first=await saveReminder(tenantId,parsed,{requireDispatchReady:true});
 assert.equal(first.created,true);
 assert.equal(first.reminders_scheduled,1);
 assert.equal(first.reminders.length,1);
 assert.equal(first.reminders[0].status,'scheduled');
 assert.equal(first.reminders[0].template,'consulta_clinica');
 const actual=DateTime.fromJSDate(new Date(first.starts_at)).setZone(zone);
 assert.equal(actual.toFormat('yyyy-MM-dd'),date);
 assert.equal(actual.toFormat('HH:mm'),'14:30');

 const repeated=await saveReminder(tenantId,parsed,{requireDispatchReady:true});
 assert.equal(repeated.created,false);
 assert.equal(repeated.event_id,first.event_id);
 assert.equal(repeated.schedule_revision,first.schedule_revision);
 assert.equal(repeated.reminders_scheduled,1);
 const duplicate=await query(
  "select count(*)::int n from events where tenant_id=$1 and external_id=$2",
  [tenantId,appointment.external_id]
 );
 assert.equal(duplicate.rows[0].n,1,'external_id duplicou evento');

 const next=strictAppointmentSyncSchema.parse({...appointment,event:{...appointment.event,date:nextDate,time:'16:45'}});
 const rescheduled=await saveReminder(tenantId,next,{requireDispatchReady:true});
 assert.equal(rescheduled.created,false);
 assert.equal(rescheduled.event_id,first.event_id);
 assert.equal(rescheduled.reminders_scheduled,1);
 assert.equal(rescheduled.schedule_revision,first.schedule_revision+1);
 const original=await query(
  "select status from scheduled_messages where tenant_id=$1 and event_id=$2 and schedule_revision=$3",
  [tenantId,first.event_id,first.schedule_revision]
 );
 assert.ok(original.rows.every(x=>x.status==='cancelled'));

 const soon=DateTime.now().setZone(zone).plus({hours:2});
 const tooClose=strictAppointmentSyncSchema.parse({
  ...appointment,external_id:'SYNC-CI-TOO-SOON',
  event:{...appointment.event,date:soon.toISODate(),time:soon.toFormat('HH:mm')}
 });
 await assert.rejects(()=>saveReminder(tenantId,tooClose,{requireDispatchReady:true}),
  (e:unknown)=>e instanceof ApiOperationError&&e.code===409);
 const notCreated=await query("select count(*)::int n from events where tenant_id=$1 and external_id='SYNC-CI-TOO-SOON'",[tenantId]);
 assert.equal(notCreated.rows[0].n,0,'Compromisso sem lembrete ficou salvo');

 // Same contract supports automotive records without vertical-specific controllers.
 const automotive=strictAppointmentSyncSchema.parse({
  external_id:'SYNC-CI-CAR-1',
  contact:{external_id:'CUSTOMER-CI-2',name:'Carlos Silva',phone:'+5519888887777',consent:true,consent_source:'CRM com consentimento'},
  record:{type:'vehicle',external_id:'CAR-CI-2',label:'Corolla ABC1D23',details:{model:'Corolla',plate:'ABC1D23'}},
  event:{title:'Revisão de veículo',type:'revisao',date,time:'10:30',timezone:zone}
 });
 const vehicle=await saveReminder(tenantId,automotive,{requireDispatchReady:true});
 assert.equal(vehicle.reminders_scheduled,1);
 const linked=await query(
  "select r.kind,r.details,e.starts_at from events e join records r on r.id=e.record_id where e.tenant_id=$1 and e.external_id=$2",
  [tenantId,automotive.external_id]
 );
 assert.equal(linked.rows[0].kind,'vehicle');
 assert.equal(linked.rows[0].details.plate,'ABC1D23');
 console.log('External appointments: required time, consent, transaction rollback, approved GoTo template, schedules, idempotent rescheduling and vertical modularization approved');
}finally{
 if(tenantId)await query('delete from tenants where id=$1',[tenantId]);
 await pool.end();
}
