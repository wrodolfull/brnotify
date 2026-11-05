import {DateTime} from 'luxon';
import {query} from './db.js';
import {normalizeWhatsAppPhone} from './whatsapp-phone.js';

export function phoneE164(v:unknown){return normalizeWhatsAppPhone(v)}
export function toUTC(value:string,timezone:string){
 // Aceita data local YYYY-MM-DD ou data/hora local YYYY-MM-DDTHH:mm.
 const dt=DateTime.fromISO(value,{zone:timezone});
 if(!dt.isValid)throw new Error('Data inválida');
 return dt.toUTC().toISO()!;
}
export function parseImportedDate(v:unknown){
 if(v instanceof Date)return DateTime.fromJSDate(v,{zone:'utc'}).toFormat('yyyy-MM-dd');
 const s=String(v??'').trim();
 const br=DateTime.fromFormat(s,'dd/MM/yyyy');
 if(br.isValid)return br.toISODate()!;
 const brTime=DateTime.fromFormat(s,'dd/MM/yyyy HH:mm');
 if(brTime.isValid)return brTime.toFormat("yyyy-MM-dd'T'HH:mm");
 if(DateTime.fromISO(s).isValid)return s;
 throw new Error('Data inválida: use DD/MM/AAAA ou AAAA-MM-DD');
}
export type Rule={slot:number;enabled:boolean;offset_value:number;offset_unit:'days'|'weeks'|'months';send_time:string;template_id:string|null};
export function calculateReminder(eventISO:string,zone:string,rule:Rule){
 const event=DateTime.fromISO(eventISO,{zone:'utc'}).setZone(zone);
 const local=event.minus({[rule.offset_unit]:rule.offset_value});
 const [hour,minute]=rule.send_time.split(':').map(Number);
 const at=local.set({hour,minute,second:0,millisecond:0});
 if(!at.isValid)throw new Error('Regra de lembrete inválida');
 return at.toUTC().toISO()!;
}

export type SqlRunner=(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;
export type DeliveryMode='automation'|'custom';
export type DeliveryScheduleInput={
 starts_at:string|Date;timezone:string;status:string;consent:boolean;opted_out_at?:string|Date|null;
 confirmation_status?:string;delivery_mode?:DeliveryMode;
 custom_send_at?:string|Date|null;custom_template_id?:string|null;
 reminder_overrides?:Record<string,any>|null;contact_overrides?:Record<string,any>|null;
};
export type PreparedReminder={slot:number;scheduled_at:string;template_id:string;template_name:string};
export type DeliveryPlan={delivery_mode:DeliveryMode;reminders:PreparedReminder[];warnings:string[];can_schedule:boolean};

export function planEventDelivery(
 input:DeliveryScheduleInput,
 rules:Array<Rule&{template_name?:string|null;template_status?:string|null}>,
 customTemplate:{id:string;name:string;status:string}|null,
 now=Date.now()
):DeliveryPlan{
 const delivery_mode=input.delivery_mode||'automation';
 const warnings:string[]=[];
 const reminders:PreparedReminder[]=[];
 const start=DateTime.fromJSDate(input.starts_at instanceof Date?input.starts_at:new Date(input.starts_at),{zone:'utc'});
 const sendDate=input.custom_send_at?DateTime.fromJSDate(input.custom_send_at instanceof Date?input.custom_send_at:new Date(input.custom_send_at),{zone:'utc'}):null;
 if(!start.isValid||start.toMillis()<=now)warnings.push('O compromisso precisa ocorrer no futuro para gerar notificações.');
 if(input.status!=='scheduled')warnings.push('O evento não está programado.');
 if(!input.consent||input.opted_out_at)warnings.push('O contato não autorizou o recebimento pelo WhatsApp.');
 if(['reschedule_requested','declined'].includes(input.confirmation_status||''))
  warnings.push('A confirmação do evento impede novos lembretes.');
 if(warnings.length)return {delivery_mode,reminders,warnings,can_schedule:false};

 if(delivery_mode==='custom'){
  if(!sendDate||!sendDate.isValid)warnings.push('Informe uma data e hora válidas para o disparo.');
  else if(sendDate.toMillis()<=now+30_000)warnings.push('O horário do envio precisa estar pelo menos 30 segundos no futuro.');
  else if(sendDate.toMillis()>=start.toMillis())warnings.push('O WhatsApp deve ser enviado antes do horário do compromisso.');
  if(!customTemplate||customTemplate.status!=='APPROVED'||customTemplate.id!==input.custom_template_id)
   warnings.push('Selecione um template aprovado da GoTo para este ambiente.');
  if(!warnings.length&&sendDate&&customTemplate)
   reminders.push({slot:1,scheduled_at:sendDate.toUTC().toISO()!,template_id:customTemplate.id,template_name:customTemplate.name});
 }else{
  const overrides=input.reminder_overrides||input.contact_overrides||{};
  for(const base of rules){
   const raw=overrides[String(base.slot)]||{};
   // Only permit timing overrides. Template identity always comes from this tenant's rule.
   const rule:Rule={...base,
    enabled:typeof raw.enabled==='boolean'?raw.enabled:base.enabled,
    offset_value:Number.isInteger(raw.offset_value)&&raw.offset_value>=1&&raw.offset_value<=365?raw.offset_value:base.offset_value,
    offset_unit:['days','weeks','months'].includes(raw.offset_unit)?raw.offset_unit:base.offset_unit,
    send_time:typeof raw.send_time==='string'&&/^\d{2}:\d{2}(:\d{2})?$/.test(raw.send_time)?raw.send_time:base.send_time
   };
   if(!rule.enabled)continue;
   if(!rule.template_id||base.template_status!=='APPROVED'){
    warnings.push('Lembrete '+rule.slot+': associe um template aprovado em Automações.');
    continue;
   }
   const due=calculateReminder(start.toUTC().toISO()!,input.timezone,rule);
   if(DateTime.fromISO(due).toMillis()<=now){
    warnings.push('Lembrete '+rule.slot+': o horário calculado já passou.');
    continue;
   }
   if(DateTime.fromISO(due).toMillis()>=start.toMillis()){
    warnings.push('Lembrete '+rule.slot+': o envio precisa ocorrer antes do compromisso.');
    continue;
   }
   reminders.push({slot:rule.slot,scheduled_at:due,template_id:rule.template_id,template_name:base.template_name||'Template aprovado'});
  }
  if(!rules.length)warnings.push('Nenhuma regra de lembrete configurada neste ambiente.');
 }
 if(!reminders.length&&!warnings.length)warnings.push('Nenhum lembrete habilitado para este evento.');
 return {delivery_mode,reminders,warnings,can_schedule:reminders.length>0};
}

export async function previewEventDelivery(
 tenantId:string,
 input:{contact_id:string;starts_at:string;delivery_mode:DeliveryMode;custom_send_at?:string|null;custom_template_id?:string|null;reminder_overrides?:Record<string,any>|null},
 run:SqlRunner=query
){
 const tenant=await run('select timezone,status from tenants where id=$1',[tenantId]);
 const contact=await run('select consent,opted_out_at,reminder_overrides from contacts where tenant_id=$1 and id=$2',[tenantId,input.contact_id]);
 if(!tenant.rowCount||!contact.rowCount)return null;
 const rules=await run(
  'select r.*, mt.name as template_name, mt.status as template_status from reminder_rules r left join message_templates mt on mt.id=r.template_id and mt.tenant_id=r.tenant_id where r.tenant_id=$1 order by r.slot',
  [tenantId]
 );
 const custom=await run(
  "select id,name,status from message_templates where tenant_id=$1 and id=$2",
  [tenantId,input.custom_template_id||null]
 );
 const zone=tenant.rows[0].timezone as string;
 const starts_at=toUTC(input.starts_at,zone);
 const custom_send_at=input.delivery_mode==='custom'&&input.custom_send_at?toUTC(input.custom_send_at,zone):null;
 const plan=planEventDelivery({
  starts_at,timezone:zone,status:'scheduled',consent:contact.rows[0].consent,
  opted_out_at:contact.rows[0].opted_out_at,
  delivery_mode:input.delivery_mode,custom_send_at,custom_template_id:input.custom_template_id,
  reminder_overrides:input.reminder_overrides,contact_overrides:contact.rows[0].reminder_overrides
 },rules.rows,custom.rows[0]||null);
 if(tenant.rows[0].status!=='active')plan.warnings.push('O ambiente está pausado e não enviará notificações.');
 // The dispatch worker cannot deliver without an authorized WhatsApp sender.
 const connection=await run('select account_key,from_touchpoint from goto_connections where tenant_id=$1',[tenantId]);
 if(!connection.rows[0]?.account_key||!connection.rows[0]?.from_touchpoint)
  plan.warnings.push('Configure o remetente WhatsApp em Integração GoTo antes de enviar.');
 plan.can_schedule=plan.reminders.length>0&&tenant.rows[0].status==='active'&&!!connection.rows[0]?.account_key&&!!connection.rows[0]?.from_touchpoint;
 return {...plan,timezone:zone};
}
export async function rebuildEvent(tenantId:string,eventId:string,run:SqlRunner=query){
 const loaded=await run(
  'select e.*,t.timezone,c.consent,c.opted_out_at,c.reminder_overrides as contact_overrides from events e join tenants t on t.id=e.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id where e.tenant_id=$1 and e.id=$2',
  [tenantId,eventId]
 );
 if(!loaded.rowCount)return;
 const ev=loaded.rows[0];
 const rules=await run(
  'select r.*,mt.name as template_name,mt.status as template_status from reminder_rules r left join message_templates mt on mt.id=r.template_id and mt.tenant_id=r.tenant_id where r.tenant_id=$1 order by r.slot',
  [tenantId]
 );
 const custom=await run(
  'select id,name,status from message_templates where tenant_id=$1 and id=$2',
  [tenantId,ev.custom_template_id||null]
 );
 const plan=planEventDelivery(ev,rules.rows,custom.rows[0]||null);
 const validSlots:number[]=[];
 for(const reminder of plan.reminders){
  validSlots.push(reminder.slot);
  await run(
   "insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,template_id,schedule_revision) values($1,$2,$3,$4,$5,$6) on conflict(event_id,slot,schedule_revision) do update set scheduled_at=excluded.scheduled_at,template_id=excluded.template_id,status='scheduled',error_code=null,error_description=null,updated_at=now() where scheduled_messages.status in ('scheduled','cancelled')",
   [tenantId,eventId,reminder.slot,reminder.scheduled_at,reminder.template_id,ev.schedule_revision]
  );
 }
 await run(
  "update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id=$2 and status='scheduled' and (schedule_revision<>$3 or not(slot=any($4::int[])))",
  [tenantId,eventId,ev.schedule_revision,validSlots]
 );
 return plan;
}
