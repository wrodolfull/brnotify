import {DateTime} from 'luxon';
import {query} from './db.js';
import {buildTemplatePayload,resolveTemplateMediaId,ProviderError,sendTemplate} from './goto.js';
import {downloadTenantMedia} from './goto-media.js';
import {registerIncomingDecision} from './confirmation.js';
import {phoneE164} from './time.js';

export async function processMessages(){
 const claimed=await query(
  "with due as (select m.id from scheduled_messages m join tenants t on t.id=m.tenant_id where m.status='scheduled' and m.scheduled_at<=now() and t.status='active' order by m.scheduled_at asc for update of m skip locked limit 20) update scheduled_messages m set status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now() from due where m.id=due.id returning m.*"
 );
 for(const msg of claimed.rows){
  let httpStatus:number|null=null;
  try{
   const data=await query(
    'select m.*,e.title,e.event_type,e.starts_at,e.status as event_status,e.confirmation_status,e.schedule_revision as event_revision,e.details as event_details,t.timezone,c.name,c.phone,c.email,c.consent,c.opted_out_at,c.custom_data,r.details as record_details,mt.name as template_name,mt.language_code,mt.status as template_status,mt.definition,mt.variable_map,g.from_touchpoint from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id join tenants t on t.id=m.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id left join records r on r.id=e.record_id and r.tenant_id=m.tenant_id left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id left join goto_connections g on g.tenant_id=m.tenant_id where m.id=$1',
    [msg.id]
   );
   const v=data.rows[0];
   if(!v)throw new Error('Evento inexistente');
   if(v.event_status!=='scheduled'||v.event_revision!==msg.schedule_revision||['reschedule_requested','declined'].includes(v.confirmation_status)||!v.consent||v.opted_out_at)throw new Error('Evento alterado, cancelado ou contato sem consentimento');
   if(!v.template_id||!v.definition||!v.from_touchpoint)throw new Error('Configure um template aprovado e remetente GoTo para este lembrete');
   if(DateTime.fromJSDate(new Date(v.starts_at)).toMillis()<=Date.now())throw new Error('Data do evento já passou');
   const template={name:v.template_name,language_code:v.language_code,status:v.template_status,definition:v.definition,variable_map:v.variable_map};
   const contact={name:v.name,phone:v.phone,email:v.email,custom_data:v.custom_data};
   const event={title:v.title,event_type:v.event_type,starts_at:v.starts_at,timezone:v.timezone,details:v.event_details};
   const record={details:v.record_details};
   const required=resolveTemplateMediaId(template,{contact,event,record});
   const attachment=required?await downloadTenantMedia(msg.tenant_id,required.assetId,required.kind):null;
   const payload=buildTemplatePayload(template,contact,event,record,v.from_touchpoint,attachment?.filename);
   const providerId=await sendTemplate(msg.tenant_id,payload,attachment?[attachment]:[]);
   await query("update scheduled_messages set status='sent',goto_message_id=$2,sent_at=now(),locked_at=null,updated_at=now() where id=$1",[msg.id,providerId]);
   await query("insert into message_attempts(tenant_id,message_id,outcome,provider_status) values($1,$2,'accepted',201)",[msg.tenant_id,msg.id]);
  }catch(err){
   const p=err instanceof ProviderError?err:null;
   httpStatus=p?.status??null;
   const detail=err instanceof Error?err.message:'Erro desconhecido';
   const unknown=httpStatus===0;
   const retryable=p&&[429,500,502,503,504].includes(p.status);
   const retry=Boolean(retryable&&msg.attempt_count<3);
   const status=unknown?'unknown':retry?'scheduled':'failed';
   const delay=DateTime.now().plus({minutes:Math.min(30,Math.pow(3,msg.attempt_count))}).toISO();
   await query(
    "update scheduled_messages set status=$2,error_code=$3,error_description=$4,scheduled_at=case when $5 then $6::timestamptz else scheduled_at end,locked_at=null,updated_at=now() where id=$1",
    [msg.id,status,httpStatus?String(httpStatus):'VALIDATION',detail,retry,delay]
   );
   await query('insert into message_attempts(tenant_id,message_id,outcome,error_detail,provider_status) values($1,$2,$3,$4,$5)',[msg.tenant_id,msg.id,status,detail,httpStatus]);
  }
 }
 return claimed.rowCount||0;
}
export async function handleGotoWebhook(event:any){
 if(!event||typeof event.id!=='string'||event.source!=='inbox-notification'||typeof event.content?.accountKey!=='string')throw new Error('Evento GoTo inválido');
 const tenant=await query('select tenant_id from goto_connections where account_key=$1',[event.content.accountKey]);
 if(!tenant.rowCount)return false;
 const tenantId=tenant.rows[0].tenant_id;
 const inserted=await query('insert into webhook_events(event_id,tenant_id,payload) values($1,$2,$3) on conflict do nothing returning event_id',[event.id,tenantId,JSON.stringify(event)]);
 if(!inserted.rowCount){
  const old=await query('select processed_at from webhook_events where event_id=$1',[event.id]);
  if(old.rows[0]?.processed_at)return true;
 }
 if(event.type==='INBOUND_MESSAGE'&&event.content.payload?.channel==='WHATSAPP'){
  const p=event.content.payload;
  const text=String(p.body||'').trim().toUpperCase();
  if(['STOP','SAIR','PARAR','CANCELAR','DESCADASTRAR'].includes(text)){
   let author='';try{author=phoneE164(p.authorTouchpoint)}catch{}
   const ct=await query("update contacts set consent=false,opted_out_at=now(),updated_at=now() where tenant_id=$1 and phone=$2 returning id",[tenantId,author]);
   for(const c of ct.rows)await query("update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id in(select id from events where tenant_id=$1 and contact_id=$2) and status='scheduled'",[tenantId,c.id]);
  }else{
   await registerIncomingDecision(tenantId,event.id,p);
  }
 }
 if(event.type==='DELIVERY_STATUS'){
  const payload=event.content.payload||{};
  if(typeof payload.messageId!=='string'){
   await query('update webhook_events set processed_at=now() where event_id=$1',[event.id]);
   return true;
  }
  const description=String(payload.deliveryStatus?.description||'UNKNOWN');
  const code=String(payload.deliveryStatus?.code||'');
  const status=description==='DELIVERED'?'delivered':code.startsWith('4')||code.startsWith('5')?'failed':'sent';
  await query(
   "update scheduled_messages set status=$1,error_code=case when $1='failed' then $2 else null end,error_description=case when $1='failed' then $3 else null end,updated_at=now() where tenant_id=$4 and goto_message_id=$5 and status in ('sent','delivered','failed') and (status<>'delivered' or $1='delivered')",
   [status,code,description,tenantId,payload.messageId]
  );
 }
 await query('update webhook_events set processed_at=now() where event_id=$1',[event.id]);
 return true;
}
