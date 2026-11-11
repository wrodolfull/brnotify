import {query} from './db.js';
import {withDispatchTransaction,randomTenantDelay,GLOBAL_MIN_DELAY_MS,
 classifyProviderFailure,retryDelayMilliseconds,deferAfterRateLimit} from './send-pacing.js';
import {buildTemplatePayload,sendTemplate,ProviderError,resolveTemplateMediaId} from './goto.js';
import {downloadTenantMedia} from './goto-media.js';
import {onDemandSchema,prepareOnDemandTemplate} from './on-demand-model.js';

export async function claimNextOnDemandMessage(){
 return withDispatchTransaction(async run=>{
  await run('select pg_advisory_xact_lock(792140,681200)');
  await run("insert into goto_send_pacing(scope) values('global') on conflict do nothing");
  const global=await run("select next_allowed_at from goto_send_pacing where scope='global' for update");
  if(new Date(global.rows[0].next_allowed_at).getTime()>Date.now())return null;
  const result=await run(
   `select m.id,m.tenant_id from on_demand_messages m
    join tenants t on t.id=m.tenant_id and t.status='active'
    left join goto_send_pacing pace on pace.scope='tenant:'||m.tenant_id::text
    where m.status='queued' and m.next_attempt_at<=clock_timestamp()
      and m.expires_at>clock_timestamp()
      and coalesce(pace.next_allowed_at,'-infinity'::timestamptz)<=clock_timestamp()
      and not exists(select 1 from scheduled_messages s where s.tenant_id=m.tenant_id and s.status='processing')
      and not exists(select 1 from on_demand_messages p where p.tenant_id=m.tenant_id and p.status='processing')
    order by m.created_at,m.id for update of m skip locked limit 1`
  );
  if(!result.rowCount)return null;
  const {id,tenant_id}=result.rows[0];
  const scope='tenant:'+tenant_id;
  await run('insert into goto_send_pacing(scope) values($1) on conflict do nothing',[scope]);
  const now=Date.now();
  await run('update goto_send_pacing set next_allowed_at=$2,updated_at=now() where scope=$1',['global',new Date(now+GLOBAL_MIN_DELAY_MS)]);
  await run('update goto_send_pacing set next_allowed_at=$2,updated_at=now() where scope=$1',[scope,new Date(now+randomTenantDelay())]);
  const claimed=await run(
   "update on_demand_messages set status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=$1 and status='queued' returning *",
   [id]
  );
  return claimed.rows[0]||null;
 });
}
export async function processOnDemandMessages(){
 const job=await claimNextOnDemandMessage();
 if(!job)return 0;
 let providerId:string|null=null;
 try{
  const selected=await query(
   `select m.*,c.name as contact_name,c.consent,c.is_active,c.opted_out_at,
      t.status as tenant_status,mt.name as template_name,mt.language_code,
      mt.status as template_status,mt.definition,mt.variable_map,
      g.from_touchpoint,k.revoked_at as token_revoked_at,k.expires_at as token_expires_at
    from on_demand_messages m
    left join contacts c on c.id=m.contact_id and c.tenant_id=m.tenant_id
    join tenants t on t.id=m.tenant_id
    left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id
    left join goto_connections g on g.tenant_id=m.tenant_id
    left join integration_api_keys k on k.id=m.api_key_id and k.tenant_id=m.tenant_id
    where m.id=$1`,
   [job.id]
  );
  const v=selected.rows[0];
  if(!v||v.tenant_status!=='active'||!v.from_touchpoint||!v.template_name)
   throw new Error('Ambiente, template ou conexão GoTo indisponível');
  if(!v.consent||v.opted_out_at||!v.is_active)throw new Error('Contato inativo, sem autorização ou com opt-out');
  if(!['panel','automation'].includes(v.source)&&(!v.api_key_id||v.token_revoked_at||!v.token_expires_at||new Date(v.token_expires_at).getTime()<=Date.now()))
   throw new Error('Chave da integração revogada ou expirada');
  if(new Date(v.expires_at).getTime()<=Date.now())throw new Error('Notificação expirou antes do envio');
  const template={name:v.template_name,language_code:v.language_code,status:v.template_status,
   definition:v.definition,variable_map:v.variable_map};
  const input=onDemandSchema.parse({
   to:v.recipient_phone,template:v.template_name,language:v.language_code,
   name:v.recipient_name,variables:v.variables||{},
   ...(v.media_asset_id?{media_asset_id:v.media_asset_id}:{}),
   consent:{confirmed:true,source:v.consent_source}
  });
  const {customized,media}=prepareOnDemandTemplate(template,input);
  const attachment=media?await downloadTenantMedia(v.tenant_id,media.assetId,media.kind):null;
  const payload=buildTemplatePayload(customized,
   {name:v.recipient_name,phone:v.recipient_phone,custom_data:{}},
   {title:'',event_type:'ivr',starts_at:new Date().toISOString(),timezone:'America/Sao_Paulo',details:{}},
   null,v.from_touchpoint,attachment?.filename);
  providerId=await sendTemplate(v.tenant_id,payload,attachment?[attachment]:[]);
  await query(
   "update on_demand_messages set status='sent',provider_message_id=$2,sent_at=now(),locked_at=null,error_code=null,error_description=null,updated_at=now() where id=$1 and status='processing'",
   [job.id,providerId]
  );
  console.info('[ivr-dispatch]',JSON.stringify({id:job.id,tenantId:job.tenant_id,status:'sent'}));
 }catch(err){
  const p=err instanceof ProviderError?err:null;
  const category=providerId?'unknown':p?classifyProviderFailure(p.status,job.attempt_count):'failed';
  const status=category==='retry'?'queued':category;
  const detail=providerId?'Mensagem aceita pela GoTo; persistência incerta, requer conciliação':
   err instanceof Error?err.message:'Erro desconhecido';
  const code=providerId?'PERSISTENCE':p?String(p.status||'UNKNOWN'):'VALIDATION';
  const retryMs=p?.status===429?retryDelayMilliseconds(job.attempt_count,p.retryAfterMs):0;
  if(p?.status===429){
   try{await deferAfterRateLimit(job.tenant_id,retryMs)}
   catch(e){console.error('[ivr-429]',e instanceof Error?e.message:'erro');}
  }
  try{
   await query(
    `update on_demand_messages set status=$2,error_code=$3,error_description=$4,
     next_attempt_at=case when $2='queued' then $5::timestamptz else next_attempt_at end,
     provider_message_id=coalesce($6,provider_message_id),
     locked_at=null,updated_at=now()
     where id=$1 and status='processing'`,
    [job.id,status,code,detail.slice(0,300),new Date(Date.now()+retryMs),providerId]
   );
   console.warn('[ivr-dispatch]',JSON.stringify({id:job.id,tenantId:job.tenant_id,status,code}));
  }catch(e){
   console.error('[ivr-persistence]',e instanceof Error?e.message:'erro');
   throw e;
  }
 }
 return 1;
}
export async function cleanupOnDemandMessages(){
 await query(
  "update on_demand_messages set status='unknown',error_code='WORKER_INTERRUPTED',error_description='Resultado incerto após parada do worker',locked_at=null,updated_at=now() where status='processing' and locked_at<now()-interval '3 minutes'"
 );
 await query(
  "update on_demand_messages set status='cancelled',error_code='EXPIRED',error_description='O pedido de WhatsApp da URA expirou antes do envio',updated_at=now() where status='queued' and expires_at<=now()"
 );
}
