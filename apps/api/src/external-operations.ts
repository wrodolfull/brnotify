import {z} from 'zod';
import {pool,query} from './db.js';
import {phoneE164,rebuildEvent,toUTC,type SqlRunner} from './time.js';

export const externalIdSchema=z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/);
const custom=z.record(z.unknown());
const localDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const contactSchema=z.object({
 external_id:externalIdSchema.optional(),
 name:z.string().trim().min(2).max(180),
 phone:z.string().min(10).max(30),
 email:z.union([z.string().email(),z.literal('')]).optional(),
 consent:z.boolean().optional(),
 consent_source:z.string().trim().min(2).max(200).optional(),
 custom_data:custom.optional()
}).strict();

export const recordSchema=z.object({
 type:z.string().trim().min(2).max(50).default('generic'),
 external_id:externalIdSchema.optional(),
 label:z.string().trim().min(1).max(180).optional(),
 details:custom.optional()
}).passthrough();

export const dateSchema=z.object({
 title:z.string().trim().min(2).max(160),
 type:z.string().trim().min(2).max(100).default('reminder'),
 date:localDate,time:localTime.default('09:00'),
 timezone:z.string().max(60).optional(),
 confirmation_enabled:z.boolean().optional(),
 details:custom.optional()
}).strict();

export const offsetsSchema=z.array(z.object({
 before:z.number().int().min(1).max(365),
 unit:z.enum(['days','weeks','months']),
 enabled:z.boolean().default(true),
 send_time:localTime.optional()
})).max(3);

export const reminderPayloadSchema=z.object({
 external_id:externalIdSchema,
 contact:contactSchema,
 record:recordSchema.optional(),
 event:dateSchema,
 reminders:offsetsSchema.optional()
}).strict();

export type ReminderPayload=z.infer<typeof reminderPayloadSchema>;

export class ApiOperationError extends Error {
 constructor(public code:number,message:string){super(message)}
}
export async function withTransaction<T>(fn:(run:SqlRunner)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{
  await client.query('begin');
  const run:SqlRunner=(sql,params=[])=>client.query(sql,params);
  const value=await fn(run);
  await client.query('commit');
  return value;
 }catch(e){await client.query('rollback');throw e}
 finally{client.release()}
}
export function offsetOverrides(input:ReminderPayload['reminders']){
 if(input===undefined)return null;
 const override:Record<string,unknown>={};
 for(let i=1;i<=3;i++)override[String(i)]={enabled:false};
 input.forEach((rule,i)=>{
  override[String(i+1)]={
   enabled:rule.enabled,
   offset_value:rule.before,
   offset_unit:rule.unit,
   ...(rule.send_time?{send_time:rule.send_time}: {})
  };
 });
 return override;
}
export async function upsertExternalContact(
 tenantId:string,body:z.infer<typeof contactSchema>,run:SqlRunner,forcedId?:string
){
 const phone=phoneE164(body.phone);
 // Um identificador externo explícito tem prioridade sobre a busca por telefone.
 const existing=forcedId
  ?await run('select * from contacts where tenant_id=$1 and id=$2 for update',[tenantId,forcedId])
  :body.external_id
  ?await run('select * from contacts where tenant_id=$1 and external_id=$2 for update',[tenantId,body.external_id])
  :await run('select * from contacts where tenant_id=$1 and phone=$2 for update',[tenantId,phone]);
 const fallback=existing.rowCount?existing:
  await run('select * from contacts where tenant_id=$1 and phone=$2 for update',[tenantId,phone]);
 const old=fallback.rows[0];
 if(!old){
  if(body.consent!==true||!body.consent_source)
   throw new ApiOperationError(422,'Novo contato exige consent=true e consent_source válido');
  const ins=await run(
   "insert into contacts(tenant_id,external_id,name,phone,email,consent,consent_source,consent_at,custom_data) values($1,$2,$3,$4,$5,true,$6,now(),$7) returning *",
   [tenantId,body.external_id||null,body.name,phone,body.email||null,body.consent_source,JSON.stringify(body.custom_data||{})]
  );
  return ins.rows[0];
 }
 // Nunca reativar um opt-out prévio a partir de um CRM externo.
 if(old.opted_out_at&&body.consent===true)
  throw new ApiOperationError(409,'Contato com opt-out: requer novo consentimento validado no painel');
 const update=await run(
  `update contacts set
    external_id=coalesce($3,external_id),
    name=$4,phone=$5,email=coalesce($6,email),
    consent=case when $7::boolean=false then false when opted_out_at is not null then false when $7::boolean=true and $8::text is not null then true else consent end,
    consent_source=case when $7::boolean=true and $8::text is not null and opted_out_at is null then $8 else consent_source end,
    consent_at=case when $7::boolean=true and $8::text is not null and opted_out_at is null then now() else consent_at end,
    opted_out_at=case when $7::boolean=false then coalesce(opted_out_at,now()) else opted_out_at end,
    custom_data=case when $9::jsonb is null then custom_data else $9::jsonb end,
    updated_at=now()
   where tenant_id=$1 and id=$2 returning *`,
  [tenantId,old.id,body.external_id||null,body.name,phone,body.email||null,
   body.consent??null,body.consent_source||null,body.custom_data?JSON.stringify(body.custom_data):null]
 );
 if(body.consent===false){
  await run("update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id in(select id from events where tenant_id=$1 and contact_id=$2) and status='scheduled'",[tenantId,old.id]);
 }
 return update.rows[0];
}
export async function saveReminder(tenantId:string,data:ReminderPayload){
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[tenantId,data.external_id]);
  const tenant=await run('select timezone,status from tenants where id=$1',[tenantId]);
  if(!tenant.rowCount||tenant.rows[0].status!=='active')
   throw new ApiOperationError(423,'Ambiente não está ativo');
  const zone=tenant.rows[0].timezone as string;
  if(data.event.timezone&&data.event.timezone!==zone)
   throw new ApiOperationError(422,'O fuso horário deve corresponder ao configurado no ambiente: '+zone);
  const startsAt=toUTC(data.event.date+'T'+data.event.time,zone);
  if(new Date(startsAt).getTime()<=Date.now())
   throw new ApiOperationError(422,'A data do evento deve estar no futuro');

  const old=await run('select * from events where tenant_id=$1 and external_id=$2 for update',[tenantId,data.external_id]);
  const contact=await upsertExternalContact(tenantId,data.contact,run);
  let recordId:string|null=old.rows[0]?.record_id||null;
  if(old.rows[0]&&old.rows[0].contact_id!==contact.id)recordId=null;
  if(data.record){
   const row=data.record;
   const details:Record<string,unknown>={...(row.details||{})};
   for(const [key,value] of Object.entries(row))
    if(!['type','external_id','label','details'].includes(key))details[key]=value;
   const label=row.label||String(details.model||details.pet_name||data.event.title).slice(0,180);
   if(row.external_id){
    const saved=await run(
     `insert into records(tenant_id,contact_id,external_id,label,kind,details)
      values($1,$2,$3,$4,$5,$6)
      on conflict(tenant_id,contact_id,external_id) where external_id is not null
      do update set label=excluded.label,kind=excluded.kind,details=excluded.details
      returning id`,
     [tenantId,contact.id,row.external_id,label,row.type,JSON.stringify(details)]
    );
    recordId=saved.rows[0].id;
   }else if(recordId){
    const saved=await run(
     'update records set label=$4,kind=$5,details=$6 where id=$1 and tenant_id=$2 and contact_id=$3 returning id',
     [recordId,tenantId,contact.id,label,row.type,JSON.stringify(details)]
    );
    if(!saved.rowCount)recordId=null;
   }
   if(!recordId){
    const saved=await run(
     'insert into records(tenant_id,contact_id,label,kind,details) values($1,$2,$3,$4,$5) returning id',
     [tenantId,contact.id,label,row.type,JSON.stringify(details)]
    );recordId=saved.rows[0].id;
   }
  }
  const overrides=offsetOverrides(data.reminders);
  const confEnabled=data.event.confirmation_enabled??old.rows[0]?.confirmation_enabled??false;
  const details=JSON.stringify(data.event.details??old.rows[0]?.details??{});
  let event:any,created=false;
  if(old.rowCount){
   const previous=old.rows[0];
   const changed=new Date(previous.starts_at).getTime()!==new Date(startsAt).getTime()
    ||previous.contact_id!==contact.id||previous.status!=='scheduled';
   const revision=previous.schedule_revision+(changed?1:0);
   const confirmationStatus=confEnabled
    ?changed||!previous.confirmation_enabled?'pending':previous.confirmation_status
    :'not_requested';
   const saved=await run(
    `update events set
      contact_id=$3,record_id=$4,title=$5,event_type=$6,starts_at=$7,details=$8,
      reminder_overrides=$9,confirmation_enabled=$10,confirmation_status=$11,
      confirmation_received_at=case when $12 then null else confirmation_received_at end,
      schedule_revision=$13,status='scheduled',updated_at=now()
     where tenant_id=$1 and id=$2 returning *`,
    [tenantId,previous.id,contact.id,recordId,data.event.title,data.event.type,
     startsAt,details,overrides===null?previous.reminder_overrides:JSON.stringify(overrides),
     confEnabled,confirmationStatus,changed,revision]
   );
   event=saved.rows[0];
  }else{
   const inserted=await run(
    `insert into events(
      tenant_id,external_id,contact_id,record_id,title,event_type,starts_at,details,
      reminder_overrides,confirmation_enabled,confirmation_status
     )values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [tenantId,data.external_id,contact.id,recordId,data.event.title,data.event.type,
     startsAt,details,overrides?JSON.stringify(overrides):null,
     confEnabled,confEnabled?'pending':'not_requested']
   );
   event=inserted.rows[0];created=true;
  }
  await rebuildEvent(tenantId,event.id,run);
  return {created,event_id:event.id,external_id:event.external_id,contact_id:contact.id,
   status:event.status,confirmation_status:event.confirmation_status,
   schedule_revision:event.schedule_revision};
 });
}
export async function getExternalEvent(tenantId:string,externalId:string){
 const r=await query(
  `select e.id,e.external_id,e.title,e.event_type,e.starts_at,e.status,
    e.confirmation_enabled,e.confirmation_status,e.confirmation_received_at,
    e.schedule_revision,c.id contact_id,c.name contact_name,c.phone
   from events e join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id
   where e.tenant_id=$1 and e.external_id=$2`,
  [tenantId,externalId]
 );
 if(!r.rowCount)throw new ApiOperationError(404,'Agendamento não encontrado');
 const ev=r.rows[0];
 const messages=await query(
  'select id,slot,scheduled_at,status,sent_at,error_code from scheduled_messages where tenant_id=$1 and event_id=$2 and schedule_revision=$3 order by slot',
  [tenantId,ev.id,ev.schedule_revision]
 );
 return {...ev,reminders:messages.rows};
}
export async function patchExternalEvent(tenantId:string,externalId:string,input:{
 date?:string;time?:string;title?:string;confirmation_enabled?:boolean;
}){
 return withTransaction(async run=>{
  const t=await run('select timezone from tenants where id=$1 and status=$2',[tenantId,'active']);
  if(!t.rowCount)throw new ApiOperationError(423,'Ambiente não está ativo');
  const zone=t.rows[0].timezone;
  await run('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[tenantId,externalId]);
  const old=await run('select * from events where tenant_id=$1 and external_id=$2 for update',[tenantId,externalId]);
  if(!old.rowCount)throw new ApiOperationError(404,'Agendamento não encontrado');
  const ev=old.rows[0];
  if(ev.status!=='scheduled')throw new ApiOperationError(409,'Evento finalizado ou cancelado; crie outro external_id');
  const d=new Date(ev.starts_at);
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  const field=(name:string)=>local.find(x=>x.type===name)?.value||'';
  const date=input.date||[field('year'),field('month'),field('day')].join('-');
  const time=input.time||[field('hour'),field('minute')].join(':');
  const startsAt=toUTC(date+'T'+time,zone);
  if(new Date(startsAt).getTime()<=Date.now())throw new ApiOperationError(422,'A nova data precisa ser futura');
  const changed=new Date(ev.starts_at).getTime()!==new Date(startsAt).getTime();
  const enabled=input.confirmation_enabled??ev.confirmation_enabled;
  const conf=enabled
   ?changed||!ev.confirmation_enabled?'pending':ev.confirmation_status
   :'not_requested';
  const updated=await run(
   `update events set starts_at=$3,title=$4,confirmation_enabled=$5,
    confirmation_status=$6,confirmation_received_at=case when $7 then null else confirmation_received_at end,
    schedule_revision=schedule_revision+case when $7 then 1 else 0 end,updated_at=now()
    where tenant_id=$1 and id=$2 returning *`,
   [tenantId,ev.id,startsAt,input.title??ev.title,enabled,conf,changed]
  );
  await rebuildEvent(tenantId,ev.id,run);
  return {external_id:externalId,event_id:ev.id,starts_at:updated.rows[0].starts_at,
   status:updated.rows[0].status,confirmation_status:updated.rows[0].confirmation_status};
 });
}
export async function cancelExternalEvent(tenantId:string,externalId:string){
 return withTransaction(async run=>{
  const changed=await run(
   "update events set status='cancelled',updated_at=now() where tenant_id=$1 and external_id=$2 and status='scheduled' returning id,external_id",
   [tenantId,externalId]
  );
  if(!changed.rowCount)throw new ApiOperationError(404,'Evento inexistente ou já cancelado');
  await run("update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id=$2 and status='scheduled'",[tenantId,changed.rows[0].id]);
  return {external_id:externalId,status:'cancelled'};
 });
}
