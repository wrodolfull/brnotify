import crypto from 'node:crypto';
import {Router} from 'express';
import {z} from 'zod';
import {query,audit} from './db.js';
import {authenticate,tenant,activeTenant,wrap} from './auth.js';
import {buildTemplatePayload,resolveTemplateMediaId,sendTemplate,ProviderError} from './goto.js';
import {templateFields} from './goto-template.js';
import {downloadTenantMedia} from './goto-media.js';
import {phoneE164} from './time.js';
import {ApiOperationError} from './external-operations.js';
import {reserveDirectSend,deferAfterRateLimit,retryDelayMilliseconds} from './send-pacing.js';
import {env} from './config.js';
import {listTemplateTestHistory} from './goto-test-history.js';

export const gotoTestRouter=Router();
gotoTestRouter.use(authenticate,tenant(true),activeTenant);
const bodySchema=z.object({
 phone:z.string().min(10).max(30),
 consent_confirmed:z.literal(true),
 test_values:z.record(z.string().max(1024)).default({}),
 media_asset_id:z.string().uuid().optional()
}).strict();

gotoTestRouter.get('/tests',wrap(async(req,res)=>{
 const items=await listTemplateTestHistory(req.tenantId!);
 res.json({items,total:items.length,page:1,pages:1});
}));

gotoTestRouter.post('/:id/test',wrap(async(req,res)=>{
 const templateId=z.string().uuid().parse(req.params.id);
 const input=bodySchema.parse(req.body);
 const phone=phoneE164(input.phone);
 const found=await query(
  'select name,language_code,status,definition,variable_map from message_templates where tenant_id=$1 and id=$2',
  [req.tenantId,templateId]
 );
 if(!found.rowCount)return res.status(404).json({error:'Template não encontrado'});
 const template=found.rows[0];
 if(template.status!=='APPROVED')return res.status(422).json({error:'Envio de teste exige template aprovado'});
 const fields=templateFields(template.definition);
 const mapping={...(template.variable_map||{})};
 for(const field of fields){
  if(field.kind==='media')continue;
  const value=input.test_values[field.key];
  if(value===undefined||!value.trim())return res.status(422).json({error:'Informe um valor de teste para '+field.label});
  mapping[field.key]='literal:'+value.trim();
 }
 if(input.media_asset_id)mapping['header.media']='asset:'+input.media_asset_id;
 const future=new Date(Date.now()+2*86400000);
 const contact={name:'Teste BR Notify',phone,email:'',custom_data:{}};
 const event={title:'Teste de template',event_type:'test',starts_at:future,timezone:'America/Sao_Paulo',details:{}};
 const record={details:{}};
 const customized={...template,variable_map:mapping};
 const media=resolveTemplateMediaId(customized,{contact,event,record});
 const file=media?await downloadTenantMedia(req.tenantId!,media.assetId,media.kind):null;
 const request=buildTemplatePayload(customized,contact,event,record,(await query('select from_touchpoint from goto_connections where tenant_id=$1',[req.tenantId])).rows[0]?.from_touchpoint,file?.filename);
 if(!request.from)throw new ApiOperationError(409,'Configure o remetente WhatsApp deste ambiente');
 const hash=crypto.createHmac('sha256',env.TOKEN_ENCRYPTION_KEY).update(phone).digest('hex');
 const logId=await reserveDirectSend(req.tenantId!,async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1),7821)',[req.tenantId]);
  const count=await run("select count(*)::int total from goto_test_sends where tenant_id=$1 and created_at>now()-interval '1 hour'",[req.tenantId]);
  if(count.rows[0].total>=5)throw new ApiOperationError(429,'Limite de cinco testes por hora neste ambiente');
  const created=await run(
   'insert into goto_test_sends(tenant_id,template_id,initiated_by,recipient_hash) values($1,$2,$3,$4) returning id',
   [req.tenantId,templateId,req.actor!.id,hash]
  );
  return created.rows[0].id as string;
 });
 let providerId:string;
 try{providerId=await sendTemplate(req.tenantId!,request,file?[file]:[])}
 catch(e){
  if(e instanceof ProviderError&&e.status===429){
   await deferAfterRateLimit(req.tenantId!,retryDelayMilliseconds(1,e.retryAfterMs));
  }
  throw e;
 }
 await query('update goto_test_sends set provider_message_id=$2 where id=$1',[logId,providerId]);
 console.info('[goto-test]',JSON.stringify({
  event:'accepted',testId:logId,providerMessageId:providerId,
  recipientFingerprint:hash.slice(0,12),
  submittedFormat:input.phone.trim().startsWith('+')?'international':'national'
 }));
 await audit(req.tenantId!,req.actor!.id,'goto.template_test_sent',{templateId,requestId:logId});
 res.status(201).json({accepted:true,message_id:providerId,notice:'Mensagem aceita pela GoTo; confirme a entrega pelo WhatsApp ou canal de notificações'});
}));
