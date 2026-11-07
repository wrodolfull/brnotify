import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import {Readable} from 'node:stream';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {query,pageParams} from './db.js';
import {withTransaction,ApiOperationError} from './external-operations.js';
import {normalizeOnDemandInput,onDemandFingerprint,prepareOnDemandTemplate,DEDUPE_WINDOW_SECONDS,MAX_SENDS_PER_HOUR_PER_NUMBER} from './on-demand-model.js';
import {validateMediaTypeForTemplate,type AllowedMime} from './goto-media.js';
import {parseImportedDate,toUTC,phoneE164} from './time.js';

const uuid=z.string().uuid();
const variables=z.record(z.string().max(200),z.string().trim().min(1).max(1024)).default({});
export const panelSendSchema=z.object({
 contact_id:uuid,template_id:uuid,variables,
 scheduled_at:z.string().trim().max(40).optional()
}).strict();
type PanelInput=z.infer<typeof panelSendSchema>;

async function prepare(tenantId:string,raw:unknown){
 const data=panelSendSchema.parse(raw);
 const [c,t,conn,zone]=await Promise.all([
  query('select id,name,phone,consent,consent_source,opted_out_at from contacts where tenant_id=$1 and id=$2',[tenantId,data.contact_id]),
  query("select id,name,language_code,status,definition,variable_map from message_templates where tenant_id=$1 and id=$2 and status='APPROVED'",[tenantId,data.template_id]),
  query('select 1 from goto_connections where tenant_id=$1 and account_key is not null and from_touchpoint is not null',[tenantId]),
  query('select timezone from tenants where id=$1 and status=\'active\'',[tenantId])
 ]);
 if(!zone.rowCount)throw new ApiOperationError(409,'O ambiente precisa estar ativo.');
 if(!c.rowCount)throw new ApiOperationError(404,'Contato não encontrado.');
 const contact=c.rows[0];
 if(!contact.consent||contact.opted_out_at||!contact.consent_source)
  throw new ApiOperationError(422,'O contato precisa ter consentimento registrado e não pode estar descadastrado.');
 if(!t.rowCount)throw new ApiOperationError(422,'Selecione um modelo aprovado na GoTo.');
 if(!conn.rowCount)throw new ApiOperationError(409,'Conecte o WhatsApp da GoTo antes de programar envios.');
 const template=t.rows[0];
 const input=normalizeOnDemandInput({
  to:contact.phone,name:contact.name,template:template.name,language:template.language_code,
  variables:data.variables,consent:{confirmed:true,source:'explicit_customer_request'}
 });
 let prepared;
 try{prepared=prepareOnDemandTemplate(template,input)}
 catch(e){throw new ApiOperationError(422,e instanceof Error?e.message:'Modelo inválido')}
 const mediaId=prepared.media?.assetId||null;
 if(mediaId){
  const meta=await query('select content_type from goto_media_assets where tenant_id=$1 and id=$2',[tenantId,mediaId]);
  if(!meta.rowCount)throw new ApiOperationError(422,'Mídia do modelo não disponível no ambiente.');
  try{validateMediaTypeForTemplate(meta.rows[0].content_type as AllowedMime,prepared.media!.kind)}
  catch{throw new ApiOperationError(422,'Mídia incompatível com o modelo.')}
 }
 let when=new Date();
 if(data.scheduled_at){
  const iso=toUTC(data.scheduled_at,zone.rows[0].timezone);
  when=new Date(iso);
  if(!Number.isFinite(when.getTime())||when.getTime()<Date.now()+30_000)
   throw new ApiOperationError(422,'Selecione um horário futuro, com pelo menos 30 segundos de antecedência.');
  if(when.getTime()>Date.now()+365*86400000)
   throw new ApiOperationError(422,'O agendamento não pode ultrapassar um ano.');
 }
 return {data,contact,template,input,mediaId,when};
}

export async function enqueuePanelNotification(tenantId:string,raw:unknown){
 const p=await prepare(tenantId,raw);
 const fingerprint=crypto.createHash('sha256').update(
  onDemandFingerprint(tenantId,p.input,p.template.id)+':'+(p.data.scheduled_at?p.when.toISOString():'now')
 ).digest('hex');
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[tenantId,fingerprint]);
  const current=await run('select id,status from on_demand_messages where tenant_id=$1 and dedupe_hash=$2 and created_at>now()-($3::int*interval \'1 second\') order by created_at desc limit 1',[tenantId,fingerprint,DEDUPE_WINDOW_SECONDS]);
  if(current.rowCount)return {id:current.rows[0].id,status:current.rows[0].status,deduplicated:true,scheduled_for:p.when};
  // Revalidate consent within the write transaction so an opt-out cannot race with queuing.
  const consent=await run('select consent,opted_out_at from contacts where tenant_id=$1 and id=$2 for update',[tenantId,p.contact.id]);
  if(!consent.rows[0]?.consent||consent.rows[0]?.opted_out_at)
   throw new ApiOperationError(409,'O contato revogou a autorização de envio.');
  const limit=await run("select count(*)::int as total from on_demand_messages where tenant_id=$1 and recipient_phone=$2 and scheduled_for >= $3::timestamptz-interval '1 hour' and scheduled_for <= $3::timestamptz+interval '1 hour'",[tenantId,p.input.to,p.when]);
  if(Number(limit.rows[0]?.total||0)>=MAX_SENDS_PER_HOUR_PER_NUMBER)
   throw new ApiOperationError(429,'Limite de notificações para este contato no período.');
  const added=await run(
   "insert into on_demand_messages(tenant_id,api_key_id,contact_id,template_id,media_asset_id,recipient_phone,recipient_name,variables,consent_source,dedupe_hash,source,scheduled_for,next_attempt_at,expires_at) values($1,null,$2,$3,$4,$5,$6,$7,$8,$9,'panel',$10,$10,$11) returning id,status",
   [tenantId,p.contact.id,p.template.id,p.mediaId,p.input.to,p.input.name,JSON.stringify(p.input.variables),
    'explicit_customer_request',fingerprint,p.when,new Date(p.when.getTime()+30*60000)]
  );
  return {id:added.rows[0].id,status:added.rows[0].status,deduplicated:false,scheduled_for:p.when};
 });
}

export async function panelHistory(tenantId:string,page:unknown,status:string|null){
 const p=pageParams(page);
 if(status&&!['queued','scheduled','processing','sent','delivered','failed','unknown','cancelled'].includes(status))
  throw new ApiOperationError(422,'Filtro de status inválido.');
 const sql="from (select m.id,m.status,m.scheduled_for as scheduled_at,m.recipient_name as contact_name,m.recipient_phone as phone,coalesce(mt.name,'Modelo GoTo') as title,m.source as origin,m.error_description from on_demand_messages m left join message_templates mt on mt.id=m.template_id and mt.tenant_id=m.tenant_id where m.tenant_id=$1 union all select s.id,s.status,s.scheduled_at,c.name,c.phone,e.title,'reminder' as origin,s.error_description from scheduled_messages s join events e on e.id=s.event_id and e.tenant_id=s.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id where s.tenant_id=$1) activity where ($2::text is null or activity.status=$2)";
 const [rows,total]=await Promise.all([
  query('select * '+sql+' order by scheduled_at desc,id desc limit 20 offset $3',[tenantId,status,p.offset]),
  query('select count(*)::int as n '+sql,[tenantId,status])
 ]);
 return {items:rows.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/20)};
}

function cell(value:any):string{
 if(value instanceof Date)return value.toLocaleDateString('pt-BR',{timeZone:'UTC'});
 if(value&&typeof value==='object'&&'text' in value)return String(value.text).trim();
 return String(value??'').trim();
}
async function parseSheet(file:Express.Multer.File){
 const book=new ExcelJS.Workbook();
 if(file.originalname.toLowerCase().endsWith('.csv')){
  const csv=file.buffer.toString('utf-8').replace(/^\uFEFF/,'');
  await book.csv.read(Readable.from([csv]),{parserOptions:{delimiter:csv.includes(';')?';':','}});
 }else await book.xlsx.load(file.buffer as any);
 const sheet=book.worksheets[0];
 if(!sheet)throw new ApiOperationError(422,'A planilha não possui dados.');
 const cols=new Map<string,number>();
 sheet.getRow(1).eachCell((c,i)=>cols.set(cell(c.value).toLowerCase(),i));
 if(!cols.has('whatsapp'))throw new ApiOperationError(422,'A planilha precisa ter uma coluna whatsapp.');
 if(sheet.rowCount>252)throw new ApiOperationError(422,'Limite de 250 linhas por envio. Divida a planilha.');
 return Array.from({length:Math.max(0,sheet.rowCount-1)},(_,i)=>{
  const row=sheet.getRow(i+2);
  const get=(key:string)=>cols.has(key)?cell(row.getCell(cols.get(key)!).value):'';
  const vals:Record<string,string>={};
  for(const [key] of cols)if(!['whatsapp','data_envio','hora_envio','nome'].includes(key)){
   const value=get(key);if(value)vals[key]=value;
  }
  return {line:i+2,phone:get('whatsapp'),date:get('data_envio'),time:get('hora_envio'),vars:vals};
 }).filter(r=>r.phone||r.date||r.time||Object.keys(r.vars).length);
}
export async function panelBatch(req:Request,res:Response,preview:boolean){
 if(!req.file)throw new ApiOperationError(422,'Selecione um arquivo CSV ou XLSX.');
 const templateId=uuid.parse(req.body.template_id);
 const rows=await parseSheet(req.file);
 if(!rows.length)throw new ApiOperationError(422,'Planilha sem linhas para enviar.');
 const zone=await query('select timezone from tenants where id=$1',[req.tenantId]);
 const failures:{row:number;error:string}[]=[];
 const items:Array<{line:number;data:PanelInput;phone:string;scheduled_at:string|null}>=[];
 for(const row of rows){
  try{
   const phone=phoneE164(row.phone);
   const contact=await query('select id from contacts where tenant_id=$1 and phone=$2',[req.tenantId,phone]);
   if(!contact.rowCount)throw new Error('Contato não cadastrado. Cadastre e registre o consentimento antes do envio.');
   let scheduled_at:string|undefined;
   if(row.date||row.time){
    if(!row.date||!row.time)throw new Error('Preencha data_envio e hora_envio juntas.');
    const date=parseImportedDate(row.date);
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))throw new Error('Use HH:mm em hora_envio.');
    scheduled_at=date.slice(0,10)+'T'+row.time;
   }
   const data={contact_id:contact.rows[0].id,template_id:templateId,variables:row.vars,...(scheduled_at?{scheduled_at}:{})};
   await prepare(req.tenantId!,data);
   items.push({line:row.line,data,phone,scheduled_at:scheduled_at||null});
  }catch(e){failures.push({row:row.line,error:e instanceof Error?e.message:'Linha inválida'});}
 }
 if(preview)return res.json({total:rows.length,valid:items.length,invalid:failures.length,errors:failures.slice(0,50),preview:items.slice(0,5).map(x=>({row:x.line,phone:x.phone,scheduled_at:x.scheduled_at}))});
 if(failures.length)return res.status(422).json({error:'Corrija as linhas inválidas antes de confirmar.',errors:failures.slice(0,50)});
 let queued=0,deduplicated=0;
 const enqueueErrors:{row:number;error:string}[]=[];
 for(const item of items){
  try{
   const result=await enqueuePanelNotification(req.tenantId!,item.data);
   if(result.deduplicated)deduplicated++;else queued++;
  }catch(e){enqueueErrors.push({row:item.line,error:e instanceof Error?e.message:'Falha ao programar'});}
 }
 return res.status(202).json({total:rows.length,queued,deduplicated,failed:enqueueErrors.length,errors:enqueueErrors.slice(0,50),notice:'Mensagens programadas na fila, não necessariamente entregues.'});
}
