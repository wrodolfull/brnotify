import {query} from './db.js';
import {withTransaction,ApiOperationError} from './external-operations.js';
import {templateFields} from './goto-template.js';
import {downloadTenantMedia,validateMediaTypeForTemplate,type AllowedMime} from './goto-media.js';
import {normalizeOnDemandInput,onDemandFingerprint,prepareOnDemandTemplate,
 DEDUPE_WINDOW_SECONDS,MAX_SENDS_PER_HOUR_PER_NUMBER} from './on-demand-model.js';

type Input=ReturnType<typeof normalizeOnDemandInput>;

export async function enqueueOnDemandMessage(tenantId:string,apiKeyId:string,body:unknown){
 const input=normalizeOnDemandInput(body);
 const result=await query(
  "select mt.id,mt.name,mt.language_code,mt.status,mt.definition,mt.variable_map from message_templates mt where mt.tenant_id=$1 and mt.name=$2 and lower(replace(mt.language_code,'-','_'))=$3 order by mt.updated_at desc limit 1",
  [tenantId,input.template,input.language.toLowerCase().replace(/-/g,'_')]
 );
 if(!result.rowCount)throw new ApiOperationError(404,'Template não encontrado neste ambiente. Sincronize a GoTo.');
 const template=result.rows[0];
 const prepared=prepareOnDemandTemplate(template,input);
 const mediaId=prepared.media?.assetId||null;
 if(mediaId){
  const meta=await query("select content_type from goto_media_assets where id=$1 and tenant_id=$2",[mediaId,tenantId]);
  if(!meta.rowCount)throw new ApiOperationError(422,'Mídia não encontrada neste ambiente');
  try{validateMediaTypeForTemplate(meta.rows[0].content_type as AllowedMime,prepared.media!.kind)}
  catch{throw new ApiOperationError(422,'Mídia incompatível com o cabeçalho do template')}
 }
 const connection=await query(
  "select 1 from goto_connections where tenant_id=$1 and account_key is not null and from_touchpoint is not null",
  [tenantId]
 );
 if(!connection.rowCount)throw new ApiOperationError(409,'Configure a conta GoTo e o número WhatsApp antes de disparar');
 const fingerprint=onDemandFingerprint(tenantId,input,template.id);
 return withTransaction(async run=>{
  // Serializes identical requests, including when several API replicas are active.
  await run('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[tenantId,fingerprint]);
  const suppression=await run(
   "select opted_out_at from contacts where tenant_id=$1 and phone=$2 for update",
   [tenantId,input.to]
  );
  if(suppression.rows[0]?.opted_out_at)
   throw new ApiOperationError(409,'Contato com opt-out registrado; novo consentimento precisa ser validado no painel.');

  const previous=await run(
   "select id,status,created_at from on_demand_messages where tenant_id=$1 and dedupe_hash=$2 and created_at>now()-($3::int*interval '1 second') order by created_at desc limit 1",
   [tenantId,fingerprint,DEDUPE_WINDOW_SECONDS]
  );
  if(previous.rowCount)return {id:previous.rows[0].id,status:previous.rows[0].status,deduplicated:true};
  const throttled=await run(
   "select count(*)::int as total from on_demand_messages where tenant_id=$1 and recipient_phone=$2 and created_at>now()-interval '1 hour'",
   [tenantId,input.to]
  );
  if(Number(throttled.rows[0]?.total||0)>=MAX_SENDS_PER_HOUR_PER_NUMBER)
   throw new ApiOperationError(429,'Limite de mensagens para este número nesta hora. Tente mais tarde.');
  // Register explicit opt-in only on user-selected IVR action. Never restore past opt-out.
  const contact=await run(
   `insert into contacts(tenant_id,name,phone,consent,consent_source,consent_at)
    values($1,$2,$3,true,$4,now())
    on conflict(tenant_id,phone) do update set
      consent=true,consent_source=excluded.consent_source,consent_at=now(),updated_at=now()
    where contacts.opted_out_at is null
    returning id,name`,
   [tenantId,input.name||'Cliente',input.to,input.consent.source]
  );
  if(!contact.rowCount)throw new ApiOperationError(409,'Contato com opt-out registrado; novo consentimento precisa ser validado no painel.');
  const row=await run(
   `insert into on_demand_messages(
    tenant_id,api_key_id,contact_id,template_id,media_asset_id,
    recipient_phone,recipient_name,variables,consent_source,dedupe_hash
   )values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,status`,
   [tenantId,apiKeyId,contact.rows[0].id,template.id,mediaId,input.to,
    input.name||contact.rows[0].name||'Cliente',JSON.stringify(input.variables),
    input.consent.source,fingerprint]
  );
  return {id:row.rows[0].id,status:row.rows[0].status,deduplicated:false};
 });
}
export async function getOnDemandMessage(tenantId:string,apiKeyId:string,messageId:string){
 const found=await query(
  "select id,status,created_at,sent_at,error_code from on_demand_messages where id=$1 and tenant_id=$2 and api_key_id=$3",
  [messageId,tenantId,apiKeyId]
 );
 return found.rows[0]||null;
}
