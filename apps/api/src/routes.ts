import {Router} from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import {z} from 'zod';
import {ruleInput} from './rule-validation.js';
import {query,pageParams,makeSlug,audit} from './db.js';
import {removeTenant,removeEvent,setContactsActive,removeContacts} from './lifecycle.js';
import {importContacts,downloadContactsTemplate} from './contact-import.js';
import {authenticate,requireSuper,tenant,activeTenant,wrap,supabase} from './auth.js';
import {segments} from './segments.js';
import {phoneE164,toUTC,rebuildEvent,previewEventDelivery} from './time.js';
import {oauthURL,exchangeCode,encrypt,getAccessToken,syncTemplates} from './goto.js';
import {importHandler,downloadTemplate} from './imports.js';
import {enqueuePanelNotification,panelBatch,panelHistory} from './panel-notifications.js';
import {handleGotoWebhook} from './scheduler.js';
import {createFlow,updateFlow,setFlowStatus,deleteFlow,listFlows,listRuns} from './automation-store.js';
import {disconnectGotoTenant} from './goto-disconnect.js';
import {normalizeGotoEvent} from './goto-event-normalizer.js';
import {recordGotoEvent,listGoToEvents,listGoToCalls} from './goto-event-store.js';
import {activateCallMonitoring,callMonitorStatus,enableCallIntelligence} from './goto-call-integration.js';
import {env} from './config.js';
import {listVisibleTenants,listTenantOptions} from './tenant-list.js';
import {loadDashboardTrend} from './dashboard-trend.js';

export const router=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(_r,f,cb)=>{
 if(!/\.(xlsx|csv)$/i.test(f.originalname))return cb(new Error('Apenas XLSX/CSV'));
 cb(null,true);
}});
const contactUpload=multer({storage:multer.memoryStorage(),
 limits:{fileSize:12*1024*1024,files:1},
 fileFilter:(_r,file,cb)=>{
  if(!/\.(csv|xlsx)$/i.test(file.originalname))return cb(new Error('Apenas arquivos XLSX/CSV'));
  cb(null,true);
 }});
const str=z.string().trim();
const uuid=z.string().uuid();
const contactInput=z.object({
 name:str.min(2).max(180),phone:str.min(10).max(30),email:z.union([z.string().email(),z.literal('')]).optional(),
 consent:z.boolean().default(false),consent_source:str.max(200).optional(),custom_data:z.record(z.unknown()).optional(),reminder_overrides:z.record(z.unknown()).nullable().optional()
});

const eventFields=z.object({
 contact_id:uuid,record_id:uuid.nullish(),title:str.min(2).max(160),event_type:str.max(100).optional(),
 starts_at:str.min(10),confirmation_enabled:z.boolean().optional(),details:z.record(z.unknown()).optional(),
 reminder_overrides:z.record(z.unknown()).nullable().optional(),
 delivery_mode:z.enum(['automation','custom']).default('automation'),
 custom_send_at:str.min(10).nullish(),custom_template_id:uuid.nullish()
});
const eventInput=eventFields.superRefine((x,ctx)=>{
 if(x.delivery_mode==='custom'&&(!x.custom_send_at||!x.custom_template_id))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Informe data, hora e template aprovado para o envio personalizado'});
});
const eventPreviewInput=eventFields.pick({
 contact_id:true,starts_at:true,reminder_overrides:true,delivery_mode:true,custom_send_at:true,custom_template_id:true
}).superRefine((x,ctx)=>{
 if(x.delivery_mode==='custom'&&(!x.custom_send_at||!x.custom_template_id))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Selecione data, hora e template para visualizar o disparo'});
});
const deny=(req:any,res:any)=>{if(!req.actor?.superAdmin)return res.status(403).json({error:'Somente Super Admin'});};

router.get('/health',(_req,res)=>res.json({ok:true,app:'brnotify-api'}));
router.post('/api/webhooks/goto/:secret',wrap(async(req,res)=>{
 if(!env.GOTO_WEBHOOK_SECRET||env.GOTO_WEBHOOK_SECRET.length<24)return res.status(503).json({error:'Webhook desabilitado'});
 const a=Buffer.from(req.params.secret||'');const b=Buffer.from(env.GOTO_WEBHOOK_SECRET);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(404).end();
 await handleGotoWebhook(req.body);
 const normalized=normalizeGotoEvent(req.body);
 if(normalized&&normalized.source==='inbox-notification'){
  const account=await query('select tenant_id,account_key from goto_connections where account_key=$1',[normalized.accountKey]);
  if(account.rowCount)await recordGotoEvent(account.rows[0].tenant_id,normalized,account.rows[0].account_key);
 }
 res.status(204).end();
}));
// Unique per-tenant webhook secret, not a tenant ID in the payload, identifies the recipient.
router.post('/api/webhooks/goto-calls/:tenantId/:secret',wrap(async(req,res)=>{
 const parsed=uuid.safeParse(req.params.tenantId);
 if(!parsed.success||typeof req.params.secret!=='string'||req.params.secret.length!==64)
  return res.status(404).end();
 const secretHash=crypto.createHash('sha256').update(req.params.secret).digest('hex');
 const monitor=await query(
  'select m.webhook_secret_hash,m.enabled,c.account_key,c.call_scopes_granted from goto_call_monitors m join goto_connections c on c.tenant_id=m.tenant_id where m.tenant_id=$1',
  [parsed.data]
 );
 if(!monitor.rowCount||!crypto.timingSafeEqual(Buffer.from(secretHash),Buffer.from(monitor.rows[0].webhook_secret_hash)))
  return res.status(404).end();
 // Stop ingesting when call permissions have been removed or monitoring is inactive.
 // Still acknowledge old provider channels to avoid unbounded retry delivery.
 if(!monitor.rows[0].call_scopes_granted)return res.status(204).end();
 // GoTo sends an empty request during notification channel provisioning.
 if(!req.body||typeof req.body!=='object'||!Object.keys(req.body).length)return res.status(204).end();
 if(!monitor.rows[0].enabled)return res.status(204).end();
 const event=normalizeGotoEvent(req.body);
 if(!event||!['call-events','call-events-report'].includes(event.source))
  return res.status(204).end();
 await recordGotoEvent(parsed.data,event,monitor.rows[0].account_key);
 return res.status(204).end();
}));
router.get('/api/goto/callback',wrap(async(req,res)=>{
 const state=String(req.query.state||''),code=String(req.query.code||'');
 if(!state||!code)return res.redirect(env.WEB_URL+'/settings?goto=error');
 const stateHash=crypto.createHash('sha256').update(state).digest('hex');
 const match=await query('delete from oauth_states where state_hash=$1 and expires_at>now() returning tenant_id,user_id,request_call_scopes',[stateHash]);
 if(!match.rowCount)return res.redirect(env.WEB_URL+'/settings?goto=state-error');
 try{
  const tokens=await exchangeCode(code);
  if(!tokens.refresh_token)throw new Error('Token de atualização ausente');
  await query(
   "insert into goto_connections(tenant_id,access_token_enc,refresh_token_enc,expires_at,principal,call_scopes_granted) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id) do update set access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,expires_at=excluded.expires_at,principal=excluded.principal,call_scopes_granted=excluded.call_scopes_granted,updated_at=now()",
   [match.rows[0].tenant_id,encrypt(tokens.access_token),encrypt(tokens.refresh_token),new Date(Date.now()+tokens.expires_in*1000),tokens.principal||null,match.rows[0].request_call_scopes]
  );
  await audit(match.rows[0].tenant_id,match.rows[0].user_id,'goto.connected');
  return res.redirect(env.WEB_URL+'/settings?goto=connected');
 }catch{return res.redirect(env.WEB_URL+'/settings?goto=error')}
}));
router.use('/api',authenticate);
router.get('/api/me',wrap(async(req,res)=>res.json(req.actor)));
router.get('/api/segments',(_req,res)=>res.json(segments));

router.get('/api/tenants',wrap(async(req,res)=>{
 res.json(await listVisibleTenants(req.actor!,req.query.page));
}));
router.get('/api/tenant-options',wrap(async(req,res)=>{
 res.json(await listTenantOptions(req.actor!));
}));
router.get('/api/tenants/:id',wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 if(!req.actor!.superAdmin&&!req.actor!.memberships.some(m=>m.tenant_id===id))return res.status(403).json({error:'Sem acesso ao ambiente'});
 const found=await query('select id,name,slug,segment,timezone,status,created_at from tenants where id=$1',[id]);
 if(!found.rowCount)return res.status(404).json({error:'Ambiente não encontrado'});
 res.json(found.rows[0]);
}));
router.post('/api/tenants',requireSuper,wrap(async(req,res)=>{
 const input=z.object({name:str.min(2).max(120),segment:z.enum(['automotive','clinic','pet','custom']),timezone:str.default('America/Sao_Paulo')}).parse(req.body);
 const slug=makeSlug(input.name)+'-'+crypto.randomBytes(3).toString('hex');
 const added=await query('insert into tenants(name,slug,segment,timezone) values($1,$2,$3,$4) returning *',[input.name,slug,input.segment,input.timezone]);
 const id=added.rows[0].id;
 for(const [slot,value,unit] of [[1,1,'months'],[2,3,'days'],[3,1,'days']] as const){
  await query('insert into reminder_rules(tenant_id,slot,enabled,offset_value,offset_unit) values($1,$2,true,$3,$4)',[id,slot,value,unit]);
 }
 await audit(id,req.actor!.id,'tenant.created',{name:input.name,segment:input.segment});
 res.status(201).json(added.rows[0]);
}));
router.patch('/api/tenants/:id',requireSuper,wrap(async(req,res)=>{
 const input=z.object({name:str.min(2).max(120).optional(),status:z.enum(['active','paused','suspended']).optional()}).refine(x=>Object.keys(x).length>0).parse(req.body);
 const result=await query('update tenants set name=coalesce($2,name),status=coalesce($3,status) where id=$1 returning *',[uuid.parse(req.params.id),input.name||null,input.status||null]);
 if(!result.rowCount)return res.status(404).json({error:'Não encontrado'});
 await audit(result.rows[0].id,req.actor!.id,'tenant.updated',input);
 res.json(result.rows[0]);
}));
router.delete('/api/tenants/:id',requireSuper,wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 // The admin must type the exact company name in the confirmation dialog.
 const input=z.object({confirm_name:z.string().min(2).max(120)}).parse(req.body);
 const found=await query('select name from tenants where id=$1',[id]);
 if(!found.rowCount)return res.status(404).json({error:'Ambiente não encontrado'});
 if(input.confirm_name!==found.rows[0].name)
  return res.status(422).json({error:'Digite o nome exato da empresa para confirmar a exclusão.'});
 const result=await removeTenant(id);
 // The row was deleted; its audit children are erased by the tenant FK.
 // Never log credentials or contact data.
 await audit(null,req.actor!.id,'tenant.deleted',{tenant_id:id});
 res.json(result);
}));
router.get('/api/members',tenant(),requireSuper,wrap(async(req,res)=>{
 const p=pageParams(req.query.page),items=await query('select tenant_id,user_id,email,role,created_at from tenant_members where tenant_id=$1 order by created_at desc limit 50 offset $2',[req.tenantId,p.offset]);
 const total=await query('select count(*)::int n from tenant_members where tenant_id=$1',[req.tenantId]);
 res.json({items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/50)});
}));
router.post('/api/members',tenant(true),requireSuper,wrap(async(req,res)=>{
 const input=z.object({email:z.string().email().transform(v=>v.toLowerCase()),role:z.enum(['admin','viewer'])}).parse(req.body);
 const existing=await query('select user_id from tenant_members where lower(email)=$1 limit 1',[input.email]);
 let userId=existing.rows[0]?.user_id;
 if(!userId){
  const invite=await supabase.auth.admin.inviteUserByEmail(input.email);
  if(invite.error||!invite.data.user)return res.status(422).json({error:invite.error?.message||'Falha ao enviar convite Supabase'});
  userId=invite.data.user.id;
 }
 await query('insert into tenant_members(tenant_id,user_id,email,role) values($1,$2,$3,$4) on conflict(tenant_id,user_id) do update set role=excluded.role',[req.tenantId,userId,input.email,input.role]);
 await audit(req.tenantId!,req.actor!.id,'member.invited',{email:input.email,role:input.role});
 res.status(201).json({email:input.email,role:input.role});
}));
router.delete('/api/members/:id',tenant(true),requireSuper,wrap(async(req,res)=>{
 await query('delete from tenant_members where tenant_id=$1 and user_id=$2',[req.tenantId,uuid.parse(req.params.id)]);
 await audit(req.tenantId!,req.actor!.id,'member.removed',{userId:req.params.id});
 res.status(204).end();
}));

router.get('/api/dashboard',tenant(),wrap(async(req,res)=>{
 const t=req.tenantId!;
 const counts=await query(
  "select count(*) filter(where status='scheduled')::int as scheduled,count(*) filter(where status='processing')::int as processing,count(*) filter(where status='sent')::int as sent,count(*) filter(where status='delivered')::int as delivered,count(*) filter(where status='failed')::int as failed,count(*) filter(where status='unknown')::int as unknown from (select status from scheduled_messages where tenant_id=$1 union all select case when status='queued' then 'scheduled' else status end from on_demand_messages where tenant_id=$1) messages",[t]);
 const [contacts,events,recent,trend,upcoming]=await Promise.all([
  query('select count(*)::int n from contacts where tenant_id=$1',[t]),
  query("select count(*)::int n from events where tenant_id=$1 and status='scheduled' and starts_at>now()",[t]),
  query(
   "select id,status,scheduled_at,error_description,name,title from (select m.id,m.status,m.scheduled_at,m.error_description,c.name,e.title,m.updated_at from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id where m.tenant_id=$1 union all select m.id,m.status,m.scheduled_for,m.error_description,m.recipient_name,coalesce(mt.name,'Mensagem WhatsApp'),m.updated_at from on_demand_messages m left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id where m.tenant_id=$1) activity order by updated_at desc limit 8",[t]),
  loadDashboardTrend(t),
  query(
   "select id,scheduled_at,name,title from (select m.id,m.scheduled_at,c.name,e.title from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id where m.tenant_id=$1 and m.status='scheduled' and m.scheduled_at>=now() union all select m.id,m.scheduled_for,m.recipient_name,coalesce(mt.name,'Mensagem WhatsApp') from on_demand_messages m left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id where m.tenant_id=$1 and m.status='queued' and m.scheduled_for>=now()) upcoming order by scheduled_at asc limit 5",[t])
 ]);
 res.json({messages:counts.rows[0],contacts:contacts.rows[0].n,events:events.rows[0].n,recent:recent.rows,trend:trend.rows,upcoming:upcoming.rows});
}));

router.get('/api/contacts',tenant(),wrap(async(req,res)=>{
 const p=pageParams(req.query.page),search=String(req.query.q||'').trim().slice(0,100);
 const state=String(req.query.state||'active');
 if(!['active','inactive'].includes(state))return res.status(422).json({error:'Filtro de contatos inválido'});
 const isActive=state==='active';
 const pattern='%'+search.replace(/[%_\\]/g,'\\$&')+'%';
 const where="tenant_id=$1 and is_active=$4 and ($2::text='' or name ilike $3 or phone ilike $3)";
 const [items,total]=await Promise.all([
  query('select * from contacts where '+where+' order by created_at desc,id desc limit $5 offset $6',
   [req.tenantId,search,pattern,isActive,p.limit,p.offset]),
  query('select count(*)::int n from contacts where '+where,[req.tenantId,search,pattern,isActive])
 ]);
 res.json({items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/p.limit)});
}));
router.patch('/api/contacts/status',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=z.object({ids:z.array(uuid).min(1).max(50),active:z.boolean()}).parse(req.body);
 const result=await setContactsActive(req.tenantId!,input.ids,input.active);
 await audit(req.tenantId!,req.actor!.id,'contacts.status_changed',{count:result.updated,active:input.active});
 res.json(result);
}));
router.delete('/api/contacts/bulk',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=z.object({ids:z.array(uuid).min(1).max(50)}).parse(req.body);
 const result=await removeContacts(req.tenantId!,input.ids);
 await audit(req.tenantId!,req.actor!.id,'contacts.deleted',{count:result.deleted});
 res.json(result);
}));
router.get('/api/contacts/import/template',tenant(),wrap(downloadContactsTemplate));
router.post('/api/contacts/import/preview',tenant(true),activeTenant,contactUpload.single('file'),
 wrap(async(req,res)=>importContacts(req,res,true)));
router.post('/api/contacts/import',tenant(true),activeTenant,contactUpload.single('file'),
 wrap(async(req,res)=>{await importContacts(req,res,false)}));
router.post('/api/contacts',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=contactInput.parse(req.body);
 const phone=phoneE164(input.phone);
 if(input.consent&&!input.consent_source)return res.status(422).json({error:'Informe a origem do consentimento'});
 const inserted=await query(
  "insert into contacts(tenant_id,name,phone,email,consent,consent_source,consent_at,custom_data,reminder_overrides) values($1,$2,$3,$4,$5,$6,case when $5 then now() end,$7,$8) returning *",
  [req.tenantId,input.name,phone,input.email||null,input.consent,input.consent_source||null,JSON.stringify(input.custom_data||{}),input.reminder_overrides?JSON.stringify(input.reminder_overrides):null]
 );
 await audit(req.tenantId!,req.actor!.id,'contact.created',{id:inserted.rows[0].id});
 res.status(201).json(inserted.rows[0]);
}));
router.patch('/api/contacts/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=contactInput.partial().parse(req.body);
 const current=await query('select * from contacts where tenant_id=$1 and id=$2',[req.tenantId,uuid.parse(req.params.id)]);
 if(!current.rowCount)return res.status(404).json({error:'Contato não encontrado'});
 if(input.consent===true&&(!input.consent_source&&!current.rows[0].consent_source||current.rows[0].opted_out_at&&!input.consent_source))return res.status(422).json({error:'Informe nova origem de consentimento para reativar'});
 const old=current.rows[0];
 const changed=await query(
  "update contacts set name=$3,phone=$4,email=$5,consent=$6,consent_source=$7,consent_at=case when $6=true and consent=false then now() else consent_at end,opted_out_at=case when $6=false then now() when $9=true then null else opted_out_at end,custom_data=$8,reminder_overrides=$10,updated_at=now() where tenant_id=$1 and id=$2 returning *",
  [req.tenantId,old.id,input.name??old.name,input.phone?phoneE164(input.phone):old.phone,input.email??old.email,input.consent??old.consent,input.consent_source??old.consent_source,JSON.stringify(input.custom_data??old.custom_data),input.consent===true&&!!input.consent_source,input.reminder_overrides===undefined?old.reminder_overrides:input.reminder_overrides?JSON.stringify(input.reminder_overrides):null]
 );
 if(input.consent===true||input.reminder_overrides!==undefined){const evs=await query("select id from events where tenant_id=$1 and contact_id=$2 and status='scheduled' and starts_at>now()",[req.tenantId,old.id]);for(const ev of evs.rows)await rebuildEvent(req.tenantId!,ev.id)}
 if(input.consent===false){
  await query("update scheduled_messages set status='cancelled' where tenant_id=$1 and event_id in(select id from events where tenant_id=$1 and contact_id=$2) and status='scheduled'",[req.tenantId,old.id]);
 }
 await audit(req.tenantId!,req.actor!.id,'contact.updated',{id:old.id});
 res.json(changed.rows[0]);
}));
router.get('/api/records',tenant(),wrap(async(req,res)=>{
 const id=uuid.parse(req.query.contact_id),p=pageParams(req.query.page);
 const list=await query('select * from records where tenant_id=$1 and contact_id=$2 order by created_at desc limit 50 offset $3',[req.tenantId,id,p.offset]);
 const count=await query('select count(*)::int n from records where tenant_id=$1 and contact_id=$2',[req.tenantId,id]);
 res.json({items:list.rows,total:count.rows[0].n,page:p.page,pages:Math.ceil(count.rows[0].n/50)});
}));
router.post('/api/records',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=z.object({contact_id:uuid,label:str.min(1).max(180),kind:str.max(50).default('generic'),details:z.record(z.unknown()).default({})}).parse(req.body);
 const added=await query('insert into records(tenant_id,contact_id,label,kind,details) select $1,id,$3,$4,$5 from contacts where id=$2 and tenant_id=$1 returning *',[req.tenantId,input.contact_id,input.label,input.kind,JSON.stringify(input.details)]);
 if(!added.rowCount)return res.status(404).json({error:'Contato não encontrado'});
 res.status(201).json(added.rows[0]);
}));
router.get('/api/events',tenant(),wrap(async(req,res)=>{
 const p=pageParams(req.query.page),id=req.query.contact_id?uuid.parse(req.query.contact_id):null;
 const items=await query('select e.*,c.name as contact_name,c.phone,r.label as record_label from events e join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id left join records r on r.id=e.record_id and r.tenant_id=e.tenant_id where e.tenant_id=$1 and ($2::uuid is null or e.contact_id=$2) order by e.starts_at desc limit 50 offset $3',[req.tenantId,id,p.offset]);
 const total=await query('select count(*)::int n from events where tenant_id=$1 and ($2::uuid is null or contact_id=$2)',[req.tenantId,id]);
 res.json({items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/50)});
}));
router.post('/api/events/preview',tenant(),wrap(async(req,res)=>{
 const input=eventPreviewInput.parse(req.body);
 const plan=await previewEventDelivery(req.tenantId!,{
  contact_id:input.contact_id,starts_at:input.starts_at,delivery_mode:input.delivery_mode,
  custom_send_at:input.custom_send_at,custom_template_id:input.custom_template_id,
  reminder_overrides:input.reminder_overrides
 });
 if(!plan)return res.status(404).json({error:'Contato ou ambiente não encontrado'});
 res.json(plan);
}));

router.get('/api/events/:id/notifications',tenant(),wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const event=await query('select id from events where tenant_id=$1 and id=$2',[req.tenantId,id]);
 if(!event.rowCount)return res.status(404).json({error:'Evento não encontrado'});
 const result=await query(
  'select m.id,m.slot,m.status,m.scheduled_at,m.sent_at,m.goto_message_id,m.attempt_count,m.error_code,m.error_description,m.schedule_revision,mt.name as template_name from scheduled_messages m left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id where m.tenant_id=$1 and m.event_id=$2 order by m.schedule_revision desc,m.slot',
  [req.tenantId,id]
 );
 res.json({items:result.rows});
}));

router.delete('/api/events/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const result=await removeEvent(req.tenantId!,uuid.parse(req.params.id));
 await audit(req.tenantId!,req.actor!.id,'event.deleted',{id:req.params.id,cancelled:result.cancelled_reminders});
 res.json(result);
}));
router.post('/api/events',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=eventInput.parse(req.body),t=await query('select timezone from tenants where id=$1',[req.tenantId]);
 const ct=await query('select id from contacts where tenant_id=$1 and id=$2 and is_active=true',[req.tenantId,input.contact_id]);
 if(!ct.rowCount)return res.status(404).json({error:'Contato ativo não encontrado'});
 const plan=await previewEventDelivery(req.tenantId!,{
  contact_id:input.contact_id,starts_at:input.starts_at,delivery_mode:input.delivery_mode,
  custom_send_at:input.custom_send_at,custom_template_id:input.custom_template_id,
  reminder_overrides:input.reminder_overrides
 });
 if(input.delivery_mode==='custom'&&!plan?.can_schedule)
  return res.status(422).json({error:plan?.warnings.join(' ')||'Não foi possível programar o WhatsApp personalizado'});
 if(input.record_id){
  const r=await query('select 1 from records where tenant_id=$1 and id=$2 and contact_id=$3',[req.tenantId,input.record_id,input.contact_id]);
  if(!r.rowCount)return res.status(422).json({error:'Registro não pertence ao contato'});
 }
 const saved=await query(
  'insert into events(tenant_id,contact_id,record_id,title,event_type,starts_at,details,reminder_overrides,confirmation_enabled,confirmation_status,delivery_mode,custom_send_at,custom_template_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *',
  [req.tenantId,input.contact_id,input.record_id||null,input.title,input.event_type||'reminder',toUTC(input.starts_at,t.rows[0].timezone),JSON.stringify(input.details||{}),input.reminder_overrides?JSON.stringify(input.reminder_overrides):null,input.confirmation_enabled??false,input.confirmation_enabled?'pending':'not_requested',
   input.delivery_mode,input.delivery_mode==='custom'?toUTC(input.custom_send_at!,t.rows[0].timezone):null,input.delivery_mode==='custom'?input.custom_template_id:null]
 );
 await rebuildEvent(req.tenantId!,saved.rows[0].id);
 const q=await query("select count(*)::int as n from scheduled_messages where tenant_id=$1 and event_id=$2 and status='scheduled'",[req.tenantId,saved.rows[0].id]);
 const reminders_scheduled=Number(q.rows[0]?.n||0);
 await audit(req.tenantId!,req.actor!.id,'event.created',{id:saved.rows[0].id,reminders_scheduled});
 res.status(201).json({...saved.rows[0],reminders_scheduled,dispatch_preview:plan});
}));
router.patch('/api/events/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=eventFields.omit({contact_id:true,record_id:true,delivery_mode:true}).partial()
  .extend({delivery_mode:z.enum(['automation','custom']).optional(),status:z.enum(['scheduled','cancelled','completed']).optional()}).parse(req.body);
 const old=await query('select * from events where tenant_id=$1 and id=$2',[req.tenantId,uuid.parse(req.params.id)]);
 if(!old.rowCount)return res.status(404).json({error:'Evento não encontrado'});
 const t=await query('select timezone from tenants where id=$1',[req.tenantId]);
 const ev=old.rows[0];
 const nextDate=input.starts_at?toUTC(input.starts_at,t.rows[0].timezone):ev.starts_at;
 const changed=new Date(nextDate).getTime()!==new Date(ev.starts_at).getTime();
 const nextMode=input.delivery_mode||ev.delivery_mode||'automation';
 const nextSendAt=nextMode==='custom'?(input.custom_send_at?toUTC(input.custom_send_at,t.rows[0].timezone):ev.custom_send_at):null;
 const nextTemplateId=nextMode==='custom'?(input.custom_template_id??ev.custom_template_id):null;
 const deliveryChanged=nextMode!==ev.delivery_mode||
  String(nextSendAt||'')!==String(ev.custom_send_at?.toISOString?.()||'')||
  nextTemplateId!==ev.custom_template_id;
 if(nextMode==='custom'&&(input.status??ev.status)==='scheduled'){
  const preview=await previewEventDelivery(req.tenantId!,{
   contact_id:ev.contact_id,starts_at:input.starts_at||new Date(nextDate).toISOString(),delivery_mode:'custom',
   custom_send_at:nextSendAt?new Date(nextSendAt).toISOString():null,custom_template_id:nextTemplateId
  });
  // Existing, already-sent custom notifications must not be revalidated on unrelated edits.
  if((changed||deliveryChanged)&&!preview?.can_schedule)
   return res.status(422).json({error:preview?.warnings.join(' ')||'Envio personalizado inválido'});
 }
 const enabled=input.confirmation_enabled??ev.confirmation_enabled;
 const nextConfirmation=enabled?(changed||!ev.confirmation_enabled?'pending':ev.confirmation_status):'not_requested';
 const saved=await query(
  'update events set title=$3,event_type=$4,starts_at=$5,status=$6,details=$7,reminder_overrides=$8,confirmation_enabled=$9,confirmation_status=$10,confirmation_received_at=case when $11 then null else confirmation_received_at end,schedule_revision=schedule_revision+case when $12 then 1 else 0 end,delivery_mode=$13,custom_send_at=$14,custom_template_id=$15,updated_at=now() where tenant_id=$1 and id=$2 returning *',
  [req.tenantId,ev.id,input.title??ev.title,input.event_type??ev.event_type,nextDate,input.status??ev.status,JSON.stringify(input.details??ev.details),input.reminder_overrides===undefined?ev.reminder_overrides:JSON.stringify(input.reminder_overrides),enabled,nextConfirmation,changed,changed||deliveryChanged,nextMode,nextSendAt,nextTemplateId]
 );
 await rebuildEvent(req.tenantId!,ev.id);await audit(req.tenantId!,req.actor!.id,'event.updated',{id:ev.id});
 res.json(saved.rows[0]);
}));
router.get('/api/reminder-rules',tenant(),wrap(async(req,res)=>{
 const result=await query('select * from reminder_rules where tenant_id=$1 order by slot',[req.tenantId]);
 res.json(result.rows.map(row=>({...row,send_time:String(row.send_time).slice(0,5)})));
}));
router.put('/api/reminder-rules',tenant(true),activeTenant,wrap(async(req,res)=>{
 const rules=ruleInput.parse(req.body);
 if(new Set(rules.map(r=>r.slot)).size!==3)return res.status(422).json({error:'Informe os três lembretes'});
 for(const r of rules){
  if(r.template_id){
   const exists=await query('select 1 from message_templates where tenant_id=$1 and id=$2',[req.tenantId,r.template_id]);
   if(!exists.rowCount)return res.status(422).json({error:'Template não pertence ao ambiente'});
  }
  await query('update reminder_rules set enabled=$3,offset_value=$4,offset_unit=$5,send_time=$6,template_id=$7 where tenant_id=$1 and slot=$2',[req.tenantId,r.slot,r.enabled,r.offset_value,r.offset_unit,r.send_time,r.template_id||null]);
 }
 await query('insert into rule_rebuild_queue(tenant_id,last_event_id) values($1,null) on conflict(tenant_id) do update set last_event_id=null,updated_at=now()',[req.tenantId]);
 await audit(req.tenantId!,req.actor!.id,'rules.updated');
 res.json({success:true,rebuilding:true});
}));
router.get('/api/messages',tenant(),wrap(async(req,res)=>{
 const p=pageParams(req.query.page),status=req.query.status?String(req.query.status):null;
 if(status&&!['scheduled','processing','sent','delivered','failed','cancelled','unknown'].includes(status))return res.status(422).json({error:'Status inválido'});
 const items=await query('select m.*,c.name as contact_name,c.phone,e.title as event_title from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id where m.tenant_id=$1 and ($2::text is null or m.status=$2) order by m.scheduled_at desc limit 50 offset $3',[req.tenantId,status,p.offset]);
 const total=await query('select count(*)::int n from scheduled_messages where tenant_id=$1 and ($2::text is null or status=$2)',[req.tenantId,status]);
 res.json({items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/50)});
}));
router.post('/api/messages/:id/retry',tenant(true),activeTenant,wrap(async(req,res)=>{
 const up=await query(
  "update scheduled_messages m set status='scheduled',next_attempt_at=now(),error_code=null,error_description=null,updated_at=now() from events e join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id where m.id=$1 and m.tenant_id=$2 and m.event_id=e.id and m.tenant_id=e.tenant_id and m.status='failed' and m.schedule_revision=e.schedule_revision and e.status='scheduled' and e.starts_at>now() and e.confirmation_status not in ('declined','reschedule_requested') and c.consent=true and c.opted_out_at is null returning m.id",
  [uuid.parse(req.params.id),req.tenantId]
 );
 if(!up.rowCount)return res.status(409).json({error:'Reenvio somente para falhas definitivas de eventos futuros e contatos autorizados; resultados indeterminados exigem conferência'});
 await audit(req.tenantId!,req.actor!.id,'message.retried',{id:req.params.id});
 res.json({success:true});
}));
router.get('/api/templates/options',tenant(),wrap(async(req,res)=>{
 const result=await query("select id,name,language_code from message_templates where tenant_id=$1 and status='APPROVED' order by name,language_code",[req.tenantId]);
 res.json({items:result.rows});
}));

router.get('/api/templates',tenant(),wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const items=await query('select id,name,language_code,status,category,definition,variable_map from message_templates where tenant_id=$1 order by name limit 50 offset $2',[req.tenantId,p.offset]);
 const total=await query('select count(*)::int n from message_templates where tenant_id=$1',[req.tenantId]);
 res.json({items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/50)});
}));
router.patch('/api/templates/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const map=z.record(z.string().max(200)).parse(req.body.variable_map);
 const updated=await query('update message_templates set variable_map=$3,updated_at=now() where tenant_id=$1 and id=$2 returning id,name,variable_map',[req.tenantId,uuid.parse(req.params.id),JSON.stringify(map)]);
 if(!updated.rowCount)return res.status(404).json({error:'Template não encontrado'});
 res.json(updated.rows[0]);
}));
router.get('/api/goto',tenant(),wrap(async(req,res)=>{
 const item=await query('select account_key,from_touchpoint,principal,expires_at,notification_channel_id,notification_subscription_id,updated_at from goto_connections where tenant_id=$1',[req.tenantId]);
 res.json({connected:!!item.rowCount,...(item.rows[0]||{})});
}));
router.get('/api/goto/oauth/start',tenant(true),activeTenant,wrap(async(req,res)=>{
 const state=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(state).digest('hex');
 const withCalls=req.query.calls==='true';
 await query("insert into oauth_states(state_hash,tenant_id,user_id,expires_at,request_call_scopes) values($1,$2,$3,now()+interval '10 minutes',$4)",[hash,req.tenantId,req.actor!.id,withCalls]);
 res.json({url:oauthURL(state,withCalls)});
}));
router.patch('/api/goto',tenant(true),activeTenant,wrap(async(req,res)=>{
 const input=z.object({account_key:z.string().regex(/^[0-9]{8,24}$/),from_touchpoint:z.string().regex(/^[0-9]{8,24}$/)}).parse(req.body);
 const previous=await query('select account_key from goto_connections where tenant_id=$1',[req.tenantId]);
 const saved=await query('update goto_connections set account_key=$2,from_touchpoint=$3,updated_at=now() where tenant_id=$1 returning account_key,from_touchpoint',[req.tenantId,input.account_key,input.from_touchpoint]);
 if(!saved.rowCount)return res.status(409).json({error:'Conecte a conta GoTo antes de salvar'});
 if(previous.rows[0]?.account_key&&previous.rows[0].account_key!==input.account_key){
  await query("update goto_call_monitors set enabled=false,last_error='Conta GoTo alterada. Reconfigure o monitoramento de telefonia.',updated_at=now() where tenant_id=$1",[req.tenantId]);
 }
 res.json(saved.rows[0]);
}));
// Revoke the local connection for this tenant even when the GoTo gateway is unavailable.
router.delete('/api/goto',tenant(true),activeTenant,wrap(async(req,res)=>{
 res.json(await disconnectGotoTenant(req.tenantId!,req.actor!.id));
}));
router.get('/api/goto/calls/status',tenant(),wrap(async(req,res)=>{
 res.json(await callMonitorStatus(req.tenantId!));
}));
router.post('/api/goto/calls/activate',tenant(true),activeTenant,wrap(async(req,res)=>{
 const result=await activateCallMonitoring(req.tenantId!);
 await audit(req.tenantId!,req.actor!.id,'goto.call_monitoring_activated',{already_active:result.already_active});
 res.status(result.already_active?200:201).json(result);
}));
router.post('/api/goto/calls/intelligence/activate',tenant(true),activeTenant,wrap(async(req,res)=>{
 const status=await enableCallIntelligence(req.tenantId!);
 await audit(req.tenantId!,req.actor!.id,'goto.call_intelligence_activated',{already_active:status.already_active});
 res.status(status.already_active?200:201).json(status);
}));
router.get('/api/goto/calls',tenant(),wrap(async(req,res)=>{
 res.json(await listGoToCalls(req.tenantId!,req.query.page));
}));
router.get('/api/goto/events',tenant(),wrap(async(req,res)=>{
 const kind=z.enum(['all','call','message','intelligence']).default('all').parse(req.query.kind);
 res.json(await listGoToEvents(req.tenantId!,req.query.page,kind));
}));
router.post('/api/goto/notifications/subscribe',tenant(true),activeTenant,wrap(async(req,res)=>{
 const channelId=z.string().regex(/^Webhook\.[A-Za-z0-9-]{20,100}$/).parse(req.body.channel_id);
 const connection=await query('select account_key,from_touchpoint from goto_connections where tenant_id=$1',[req.tenantId]);
 if(!connection.rowCount||!connection.rows[0].account_key)return res.status(409).json({error:'Configure a conta GoTo'});
 const accountKey=connection.rows[0].account_key;
 const {gotoRequest}=await import('./goto.js');
 const result=await gotoRequest(req.tenantId!,'/messaging/v2/subscriptions',{
  method:'POST',json:{accountKey,ownerEntity:accountKey,ownerEntityType:'ORGANIZATION',channelId,eventTypes:['INBOUND_MESSAGE','DELIVERY_STATUS']}
 }) as {id?:string};
 await query('update goto_connections set notification_channel_id=$2,notification_subscription_id=$3,updated_at=now() where tenant_id=$1',[req.tenantId,channelId,result.id||null]);
 await audit(req.tenantId!,req.actor!.id,'goto.notifications_subscribed',{channelId});
 res.status(201).json({id:result.id||null,channelId});
}));
router.post('/api/goto/templates/sync',tenant(true),activeTenant,wrap(async(req,res)=>{
 const count=await syncTemplates(req.tenantId!);
 await audit(req.tenantId!,req.actor!.id,'goto.templates_synced',{count});
 res.json({count});
}));
// Simple panel notifications do not create appointments/events.
// Automation workflows are distinct from legacy appointment reminder rules.
router.get('/api/automation-flows',tenant(),wrap(async(req,res)=>{
 res.json(await listFlows(req.tenantId!,req.query.page));
}));
router.post('/api/automation-flows',tenant(true),activeTenant,wrap(async(req,res)=>{
 const flow=await createFlow(req.tenantId!,req.body);
 await audit(req.tenantId!,req.actor!.id,'automation.created',{id:flow.id});
 res.status(201).json(flow);
}));
router.put('/api/automation-flows/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const flow=await updateFlow(req.tenantId!,req.params.id,req.body);
 await audit(req.tenantId!,req.actor!.id,'automation.updated',{id:flow.id});
 res.json(flow);
}));
router.delete('/api/automation-flows/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const result=await deleteFlow(req.tenantId!,req.params.id);
 await audit(req.tenantId!,req.actor!.id,'automation.deleted',{
  id:req.params.id,removed_runs:result.removed_runs,
  cancelled_messages:result.cancelled_messages,cancelled_webhooks:result.cancelled_webhooks
 });
 res.json(result);
}));
router.post('/api/automation-flows/:id/status',tenant(true),activeTenant,wrap(async(req,res)=>{
 const status=z.enum(['active','paused']).parse(req.body?.status);
 const flow=await setFlowStatus(req.tenantId!,req.params.id,status);
 await audit(req.tenantId!,req.actor!.id,'automation.status_changed',{id:flow.id,status});
 res.json(flow);
}));
router.get('/api/automation-runs',tenant(),wrap(async(req,res)=>{
 res.json(await listRuns(req.tenantId!,req.query.page,req.query.flow_id?String(req.query.flow_id):null));
}));
router.get('/api/automation-options',tenant(),wrap(async(req,res)=>{
 const [templates,endpoints]=await Promise.all([
  query("select id,name,language_code,definition from message_templates where tenant_id=$1 and status='APPROVED' order by name limit 100",[req.tenantId]),
  query('select id,label,destination_url from outbound_webhook_endpoints where tenant_id=$1 and active=true order by label limit 20',[req.tenantId])
 ]);
 res.json({templates:templates.rows,endpoints:endpoints.rows});
}));

router.get('/api/notifications/templates',tenant(),wrap(async(req,res)=>{
 const items=await query("select id,name,language_code,definition,variable_map from message_templates where tenant_id=$1 and status='APPROVED' order by name,language_code limit 200",[req.tenantId]);
 res.json({items:items.rows});
}));
router.post('/api/notifications/send',tenant(true),activeTenant,wrap(async(req,res)=>{
 const queued=await enqueuePanelNotification(req.tenantId!,req.body);
 await audit(req.tenantId!,req.actor!.id,'notification.panel_queued',{id:queued.id});
 res.status(202).json({...queued,notice:'Programado na fila, aguardando envio e confirmação da GoTo.'});
}));
router.get('/api/notifications/history',tenant(),wrap(async(req,res)=>{
 res.json(await panelHistory(req.tenantId!,req.query.page,req.query.status?String(req.query.status):null));
}));
router.post('/api/notifications/:id/cancel',tenant(true),activeTenant,wrap(async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const result=await query("update on_demand_messages set status='cancelled',updated_at=now() where tenant_id=$1 and id=$2 and source='panel' and status='queued' returning id",[req.tenantId,id]);
 if(!result.rowCount)return res.status(409).json({error:'Este envio não pode ser cancelado. Verifique se já foi processado.'});
 await audit(req.tenantId!,req.actor!.id,'notification.panel_cancelled',{id});
 res.json({id,status:'cancelled'});
}));
router.post('/api/notifications/batch/preview',tenant(true),activeTenant,upload.single('file'),wrap((req,res)=>panelBatch(req,res,true)));
router.post('/api/notifications/batch',tenant(true),activeTenant,upload.single('file'),wrap((req,res)=>panelBatch(req,res,false)));

router.get('/api/imports/template',tenant(),wrap(downloadTemplate));
router.post('/api/imports/preview',tenant(true),activeTenant,upload.single('file'),wrap((req,res)=>importHandler(req,res,true)));
router.post('/api/imports',tenant(true),activeTenant,upload.single('file'),wrap(async(req,res)=>{await importHandler(req,res,false);await audit(req.tenantId!,req.actor!.id,'import.completed');}));
router.get('/api/imports',tenant(),wrap(async(req,res)=>{
 const p=pageParams(req.query.page);
 const items=await query('select * from import_jobs where tenant_id=$1 order by created_at desc limit 50 offset $2',[req.tenantId,p.offset]);
 const count=await query('select count(*)::int n from import_jobs where tenant_id=$1',[req.tenantId]);
 res.json({items:items.rows,total:count.rows[0].n,page:p.page,pages:Math.ceil(count.rows[0].n/50)});
}));
