import {Router} from 'express';
import crypto from 'node:crypto';
import {z} from 'zod';
import {query,audit,pageParams} from './db.js';
import {authenticate,tenant,activeTenant,wrap} from './auth.js';
import {API_SCOPES,generateApiKey,scopesSchema} from './integration-keys.js';
import {encrypt} from './goto.js';
import {assertSafeWebhookUrl,WEBHOOK_EVENT_TYPES} from './outbound-webhooks.js';

export const integrationAdminRouter=Router();
integrationAdminRouter.use(authenticate,tenant(true),activeTenant);
const uuid=z.string().uuid();

integrationAdminRouter.get('/keys',wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const [items,total]=await Promise.all([
  query('select id,label,token_prefix,scopes,expires_at,last_used_at,revoked_at,created_at from integration_api_keys where tenant_id=$1 order by created_at desc limit 20 offset $2',[req.tenantId,p.offset]),
  query('select count(*)::int total from integration_api_keys where tenant_id=$1',[req.tenantId])
 ]);
 res.json({items:items.rows,page:p.page,total:total.rows[0].total,pages:Math.ceil(total.rows[0].total/20),available_scopes:API_SCOPES});
}));
integrationAdminRouter.post('/keys',wrap(async(req,res)=>{
 const v=z.object({
  label:z.string().trim().min(2).max(80),
  scopes:scopesSchema,
  expires_in_days:z.number().int().min(1).max(365).default(90)
 }).parse(req.body);
 const count=await query("select count(*)::int total from integration_api_keys where tenant_id=$1 and revoked_at is null and expires_at>now()",[req.tenantId]);
 if(count.rows[0].total>=10)return res.status(409).json({error:'Máximo de 10 chaves ativas por ambiente'});
 const created=generateApiKey();
 const inserted=await query(
  "insert into integration_api_keys(tenant_id,label,token_prefix,token_hash,scopes,expires_at,created_by) values($1,$2,$3,$4,$5,now()+($6::int*interval '1 day'),$7) returning id,label,token_prefix,scopes,expires_at,created_at",
  [req.tenantId,v.label,created.prefix,created.hash,v.scopes,v.expires_in_days,req.actor!.id]
 );
 await audit(req.tenantId!,req.actor!.id,'integration.key_created',{id:inserted.rows[0].id,scopes:v.scopes});
 res.status(201).json({...inserted.rows[0],token:created.token});
}));
integrationAdminRouter.delete('/keys/:id',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const updated=await query("update integration_api_keys set revoked_at=now() where id=$1 and tenant_id=$2 and revoked_at is null returning id",[id,req.tenantId]);
 if(!updated.rowCount)return res.status(404).json({error:'Chave não encontrada ou já revogada'});
 await audit(req.tenantId!,req.actor!.id,'integration.key_revoked',{id});
 res.status(204).end();
}));
integrationAdminRouter.get('/webhooks',wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const [items,count]=await Promise.all([
  query('select id,label,destination_url,event_types,active,created_at,updated_at from outbound_webhook_endpoints where tenant_id=$1 order by created_at desc limit 20 offset $2',[req.tenantId,p.offset]),
  query('select count(*)::int total from outbound_webhook_endpoints where tenant_id=$1',[req.tenantId])
 ]);
 res.json({items:items.rows,page:p.page,total:count.rows[0].total,pages:Math.ceil(count.rows[0].total/20),available_events:WEBHOOK_EVENT_TYPES});
}));
integrationAdminRouter.post('/webhooks',wrap(async(req,res)=>{
 const v=z.object({
  label:z.string().trim().min(2).max(80),
  url:z.string().url().max(1024),
  event_types:z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length)
   .refine(arr=>new Set(arr).size===arr.length)
 }).parse(req.body);
 // DNS validado antes de gravar e novamente em cada envio; requisição fixará o endereço resolvido.
 await assertSafeWebhookUrl(v.url);
 const count=await query('select count(*)::int total from outbound_webhook_endpoints where tenant_id=$1',[req.tenantId]);
 if(count.rows[0].total>=5)return res.status(409).json({error:'Máximo de cinco endpoints por ambiente'});
 const secret='whsec_'+crypto.randomBytes(32).toString('hex');
 const inserted=await query(
  'insert into outbound_webhook_endpoints(tenant_id,label,destination_url,signing_secret_enc,event_types) values($1,$2,$3,$4,$5) returning id,label,destination_url,event_types,active,created_at',
  [req.tenantId,v.label,v.url,encrypt(secret),v.event_types]
 );
 await audit(req.tenantId!,req.actor!.id,'integration.webhook_created',{id:inserted.rows[0].id});
 res.status(201).json({...inserted.rows[0],signing_secret:secret});
}));
integrationAdminRouter.patch('/webhooks/:id',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const v=z.object({
  active:z.boolean().optional(),
  event_types:z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional()
 }).refine(d=>Object.keys(d).length>0).parse(req.body);
 const row=await query(
  "update outbound_webhook_endpoints set active=coalesce($3,active),event_types=coalesce($4,event_types),updated_at=now() where tenant_id=$1 and id=$2 returning id,label,destination_url,active,event_types,updated_at",
  [req.tenantId,id,v.active??null,v.event_types??null]
 );
 if(!row.rowCount)return res.status(404).json({error:'Webhook não encontrado'});
 await audit(req.tenantId!,req.actor!.id,'integration.webhook_updated',{id});
 res.json(row.rows[0]);
}));
integrationAdminRouter.post('/webhooks/:id/rotate',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id),secret='whsec_'+crypto.randomBytes(32).toString('hex');
 const found=await query(
  'update outbound_webhook_endpoints set signing_secret_enc=$3,updated_at=now() where tenant_id=$1 and id=$2 returning id,label',
  [req.tenantId,id,encrypt(secret)]
 );
 if(!found.rowCount)return res.status(404).json({error:'Webhook não encontrado'});
 await audit(req.tenantId!,req.actor!.id,'integration.webhook_secret_rotated',{id});
 res.json({...found.rows[0],signing_secret:secret});
}));
integrationAdminRouter.delete('/webhooks/:id',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const removed=await query('delete from outbound_webhook_endpoints where tenant_id=$1 and id=$2 returning id',[req.tenantId,id]);
 if(!removed.rowCount)return res.status(404).json({error:'Webhook não encontrado'});
 await audit(req.tenantId!,req.actor!.id,'integration.webhook_removed',{id});
 res.status(204).end();
}));
integrationAdminRouter.get('/deliveries',wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const status=req.query.status?z.enum(['queued','processing','delivered','dead']).parse(req.query.status):null;
 const [items,count]=await Promise.all([
  query("select d.id,d.endpoint_id,e.label endpoint_label,d.event_type,d.status,d.attempts,d.created_at,d.delivered_at,d.last_status_code,d.last_error from outbound_webhook_deliveries d join outbound_webhook_endpoints e on e.id=d.endpoint_id and e.tenant_id=d.tenant_id where d.tenant_id=$1 and ($2::text is null or d.status=$2) order by d.created_at desc limit 20 offset $3",[req.tenantId,status,p.offset]),
  query('select count(*)::int total from outbound_webhook_deliveries where tenant_id=$1 and ($2::text is null or status=$2)',[req.tenantId,status])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
integrationAdminRouter.post('/deliveries/:id/retry',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const changed=await query(
  "update outbound_webhook_deliveries d set status='queued',next_attempt_at=now(),last_error=null where id=$1 and tenant_id=$2 and status='dead' returning id",
  [id,req.tenantId]
 );
 if(!changed.rowCount)return res.status(409).json({error:'Apenas entregas com falha definitiva podem ser reprocessadas'});
 await audit(req.tenantId!,req.actor!.id,'integration.webhook_retry',{id});
 res.json({queued:true});
}));
integrationAdminRouter.get('/logs',wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const [items,count]=await Promise.all([
  query('select l.id,l.request_id,l.method,l.route,l.status_code,l.duration_ms,l.created_at,k.label key_label from integration_api_logs l left join integration_api_keys k on k.id=l.api_key_id where l.tenant_id=$1 order by l.created_at desc limit 20 offset $2',[req.tenantId,p.offset]),
  query('select count(*)::int total from integration_api_logs where tenant_id=$1',[req.tenantId])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
integrationAdminRouter.get('/inbound',wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const [items,count]=await Promise.all([
  query('select i.id,i.decision,i.resolution,i.received_at,c.name contact_name,e.title event_title,e.external_id from inbound_interactions i left join contacts c on c.id=i.contact_id and c.tenant_id=i.tenant_id left join events e on e.id=i.event_id and e.tenant_id=i.tenant_id where i.tenant_id=$1 order by i.received_at desc limit 20 offset $2',[req.tenantId,p.offset]),
  query('select count(*)::int total from inbound_interactions where tenant_id=$1',[req.tenantId])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
