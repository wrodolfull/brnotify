import crypto from 'node:crypto';
import {z} from 'zod';
import {env} from './config.js';
import {normalizeWhatsAppPhone} from './whatsapp-phone.js';
import {templateFields,type WhatsAppTemplate,buildTemplatePayload,resolveTemplateMediaId} from './goto-template.js';
import {ApiOperationError} from './external-operations.js';

export const DEDUPE_WINDOW_SECONDS=120;
export const MAX_SENDS_PER_HOUR_PER_NUMBER=10;
export const onDemandSchema=z.object({
 to:z.string().trim().min(8).max(45),
 template:z.string().trim().min(1).max(180),
 language:z.string().trim().min(2).max(20).default('pt_BR'),
 name:z.string().trim().min(1).max(180).optional(),
 variables:z.record(z.string().max(200),z.string().trim().min(1).max(1024)).default({}),
 media_asset_id:z.string().uuid().optional(),
 consent:z.object({
  confirmed:z.literal(true),
  source:z.enum(['ivr_option_whatsapp','explicit_customer_request'])
 }).strict()
}).strict();
export type OnDemandInput=z.infer<typeof onDemandSchema>;
export function normalizeOnDemandInput(value:unknown):OnDemandInput{
 const input=onDemandSchema.parse(value);
 return {...input,to:normalizeWhatsAppPhone(input.to)};
}
export function onDemandFingerprint(tenantId:string,input:OnDemandInput,templateId:string){
 const fields=Object.keys(input.variables).sort().map(k=>[k,input.variables[k]]);
 const base=JSON.stringify({
  tenantId,phone:input.to,templateId,language:input.language.toLowerCase().replace(/-/g,'_'),
  variables:fields,media_asset_id:input.media_asset_id||null
 });
 return crypto.createHmac('sha256',env.TOKEN_ENCRYPTION_KEY).update(base).digest('hex');
}
/** Every variable is explicit; never depend on the context of a nonexistent appointment. */
export function prepareOnDemandTemplate(template:WhatsAppTemplate,input:OnDemandInput){
 if(template.status!=='APPROVED')throw new ApiOperationError(422,'O template precisa estar aprovado na GoTo');
 const fields=templateFields(template.definition);
 const required=fields.filter(f=>f.kind!=='media');
 const keys=new Set(required.map(f=>f.key));
 for(const key of Object.keys(input.variables)){
  if(!keys.has(key))throw new ApiOperationError(422,'Variável desconhecida: '+key);
 }
 for(const field of required){
  if(!input.variables[field.key])throw new ApiOperationError(422,'Informe a variável: '+field.key);
 }
 const mapping:Record<string,string>={...(template.variable_map||{})};
 for(const [key,value] of Object.entries(input.variables))mapping[key]='literal:'+value;
 if(input.media_asset_id)mapping['header.media']='asset:'+input.media_asset_id;
 const customized={...template,variable_map:mapping};
 const media=resolveTemplateMediaId(customized,{
  contact:{name:input.name||'Cliente',phone:input.to},
  event:{title:'',starts_at:new Date().toISOString(),timezone:'America/Sao_Paulo',details:{}},
  record:null
 });
 return {customized,media};
}
export function makeOnDemandPayload(template:WhatsAppTemplate,input:OnDemandInput,from:string,mediaFilename?:string){
 const prepared=prepareOnDemandTemplate(template,input);
 return buildTemplatePayload(prepared.customized,
  {name:input.name||'Cliente',phone:input.to,custom_data:{}},
  {title:'',event_type:'ivr',starts_at:new Date().toISOString(),timezone:'America/Sao_Paulo',details:{}},
  null,from,mediaFilename);
}
