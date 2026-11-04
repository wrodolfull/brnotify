import {Router} from 'express';
import {z} from 'zod';
import {query,pageParams} from './db.js';
import {wrap} from './auth.js';
import {
 authenticateApiKey,apiKeyRateLimiter,requireScope,logIntegrationAccess
} from './integration-keys.js';
import {
 contactSchema,reminderPayloadSchema,externalIdSchema,
 saveReminder,getExternalEvent,patchExternalEvent,cancelExternalEvent,
 upsertExternalContact,withTransaction,ApiOperationError
} from './external-operations.js';
import {openApiDefinition} from './openapi.js';

export const publicApiRouter=Router();
const uuid=z.string().uuid();
const json=(value:unknown)=>JSON.stringify(value);

publicApiRouter.get('/openapi.json',(_req,res)=>res.json(openApiDefinition));
publicApiRouter.use(authenticateApiKey,apiKeyRateLimiter,logIntegrationAccess);

publicApiRouter.get('/contacts',requireScope('contacts:read'),wrap(async(req,res)=>{
 const tenantId=req.integrationKey!.tenantId,p=pageParams(req.query.page);
 const q=String(req.query.q||'').trim().slice(0,80);
 const like='%'+q.replace(/[%_\\]/g,'\\$&')+'%';
 const where="tenant_id=$1 and ($2::text='' or name ilike $3 or phone ilike $3)";
 const [items,count]=await Promise.all([
  query('select id,external_id,name,phone,email,consent,opted_out_at,created_at,updated_at from contacts where '+where+' order by created_at desc limit 20 offset $4',[tenantId,q,like,p.offset]),
  query('select count(*)::int total from contacts where '+where,[tenantId,q,like])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
publicApiRouter.post('/contacts',requireScope('contacts:write'),wrap(async(req,res)=>{
 const v=contactSchema.parse(req.body);
 const result=await withTransaction(run=>upsertExternalContact(req.integrationKey!.tenantId,v,run));
 res.status(200).json({id:result.id,external_id:result.external_id,name:result.name,phone:result.phone,consent:result.consent,opted_out:!!result.opted_out_at});
}));
publicApiRouter.patch('/contacts/:id',requireScope('contacts:write'),wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id),tenantId=req.integrationKey!.tenantId;
 const input=contactSchema.partial().parse(req.body);
 const current=await query('select * from contacts where id=$1 and tenant_id=$2',[id,tenantId]);
 if(!current.rowCount)return res.status(404).json({error:'Contato inexistente'});
 const old=current.rows[0];
 if(input.external_id&&old.external_id&&input.external_id!==old.external_id)
  return res.status(409).json({error:'Não altere o identificador externo de um contato'});
 const updated=await withTransaction(run=>upsertExternalContact(tenantId,{
  name:input.name??old.name,phone:input.phone??old.phone,
  email:input.email??old.email??undefined,
  external_id:old.external_id??input.external_id,
  consent:input.consent,
  consent_source:input.consent_source,
  custom_data:input.custom_data
 },run,id));
 res.json({id:updated.id,external_id:updated.external_id,name:updated.name,phone:updated.phone,consent:updated.consent,opted_out:!!updated.opted_out_at});
}));

async function writeReminder(req:any,res:any){
 const data=reminderPayloadSchema.parse(req.body);
 const result=await saveReminder(req.integrationKey.tenantId,data);
 res.status(result.created?201:200).json(result);
}
publicApiRouter.post('/reminders',requireScope('events:write'),requireScope('contacts:write'),wrap(writeReminder));
publicApiRouter.post('/events',requireScope('events:write'),requireScope('contacts:write'),wrap(writeReminder));

publicApiRouter.get('/events',requireScope('events:read'),wrap(async(req,res)=>{
 const tenantId=req.integrationKey!.tenantId,p=pageParams(req.query.page);
 const status=req.query.status?z.enum(['scheduled','cancelled','completed']).parse(req.query.status):null;
 const [items,count]=await Promise.all([
  query('select id,external_id,title,starts_at,status,confirmation_enabled,confirmation_status,updated_at from events where tenant_id=$1 and external_id is not null and ($2::text is null or status=$2) order by starts_at desc limit 20 offset $3',[tenantId,status,p.offset]),
  query('select count(*)::int total from events where tenant_id=$1 and external_id is not null and ($2::text is null or status=$2)',[tenantId,status])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
publicApiRouter.get('/events/:externalId',requireScope('events:read'),wrap(async(req,res)=>{
 const id=externalIdSchema.parse(req.params.externalId);
 res.json(await getExternalEvent(req.integrationKey!.tenantId,id));
}));
publicApiRouter.get('/reminders/:externalId',requireScope('events:read'),wrap(async(req,res)=>{
 const id=externalIdSchema.parse(req.params.externalId);
 res.json(await getExternalEvent(req.integrationKey!.tenantId,id));
}));
publicApiRouter.patch('/events/:externalId',requireScope('events:write'),wrap(async(req,res)=>{
 const id=externalIdSchema.parse(req.params.externalId);
 const v=z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  title:z.string().trim().min(2).max(160).optional(),
  confirmation_enabled:z.boolean().optional()
 }).strict().refine(obj=>Object.keys(obj).length>0).parse(req.body);
 res.json(await patchExternalEvent(req.integrationKey!.tenantId,id,v));
}));
publicApiRouter.post('/events/:externalId/cancel',requireScope('events:write'),wrap(async(req,res)=>{
 const id=externalIdSchema.parse(req.params.externalId);
 res.json(await cancelExternalEvent(req.integrationKey!.tenantId,id));
}));
publicApiRouter.get('/messages',requireScope('messages:read'),wrap(async(req,res)=>{
 const tenantId=req.integrationKey!.tenantId,p=pageParams(req.query.page);
 const ref=req.query.external_id?externalIdSchema.parse(req.query.external_id):null;
 const [items,count]=await Promise.all([
  query(`select m.id,m.slot,m.scheduled_at,m.status,m.sent_at,m.error_code,e.external_id
   from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id
   where m.tenant_id=$1 and ($2::text is null or e.external_id=$2)
   order by m.scheduled_at desc limit 20 offset $3`,[tenantId,ref,p.offset]),
  query('select count(*)::int total from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id where m.tenant_id=$1 and ($2::text is null or e.external_id=$2)',[tenantId,ref])
 ]);
 res.json({items:items.rows,total:count.rows[0].total,page:p.page,pages:Math.ceil(count.rows[0].total/20)});
}));
publicApiRouter.post('/imports',requireScope('imports:write'),requireScope('events:write'),requireScope('contacts:write'),wrap(async(req,res)=>{
 const tenantId=req.integrationKey!.tenantId;
 const v=z.object({items:z.array(reminderPayloadSchema).min(1).max(50)}).strict().parse(req.body);
 const imported:any[]=[];
 const errors:{index:number;external_id:string;message:string}[]=[];
 for(let i=0;i<v.items.length;i++){
  const input=v.items[i];
  try{
   const r=await saveReminder(tenantId,input);
   imported.push({index:i,external_id:r.external_id,event_id:r.event_id,created:r.created});
  }catch(e){
   errors.push({index:i,external_id:input.external_id,
    message:e instanceof ApiOperationError?e.message:'Não foi possível salvar este item'});
  }
 }
 const persisted=await query(
  "insert into import_jobs(tenant_id,file_name,imported,rejected,errors) values($1,'API JSON', $2,$3,$4) returning id",
  [tenantId,imported.length,errors.length,json(errors)]
 );
 res.status(207).json({
  job_id:persisted.rows[0].id,total:v.items.length,
  imported:imported.length,rejected:errors.length,items:imported,errors
 });
}));
publicApiRouter.get('/imports/:id',requireScope('events:read'),wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const r=await query(
  'select id,file_name,imported,rejected,errors,created_at from import_jobs where id=$1 and tenant_id=$2',
  [id,req.integrationKey!.tenantId]
 );
 if(!r.rowCount)return res.status(404).json({error:'Importação não encontrada'});
 res.json(r.rows[0]);
}));
