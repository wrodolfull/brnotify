import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import type {Request,Response} from 'express';
import {query} from './db.js';
import {segments} from './segments.js';
import {phoneE164,parseImportedDate,toUTC,rebuildEvent} from './time.js';
type ImportRow={name:string;phone:string;email:string;consent:boolean;consentSource:string;label:string;fields:Record<string,string>;title:string;startsAt:string;reminders:Record<string,unknown>|null};
const baseHeaders=['nome','whatsapp','email','consentimento','origem_consentimento','registro','tipo_evento','data_evento','hora_evento'];
const optionalHeaders=['lembrete_1','lembrete_2','lembrete_3'];
function headers(segment:keyof typeof segments){return [...baseHeaders,...segments[segment].fields.map(x=>x[0]),...optionalHeaders]}
const cell=(value:any):string=>{
 if(value instanceof Date)return value.toLocaleDateString('pt-BR',{timeZone:'UTC'});
 if(value&&typeof value==='object'&&'text' in value)return String(value.text);
 return String(value??'').trim();
};
async function readFile(file:Express.Multer.File){
 const book=new ExcelJS.Workbook();
 if(file.originalname.toLowerCase().endsWith('.csv')){
  const csv=Buffer.from(file.buffer).toString('utf-8').replace(/^\uFEFF/,'');
  // ExcelJS CSV parser: separador explícito para modelo CSV exportado.
  const stream=await import('node:stream');
  await book.csv.read(stream.Readable.from([csv]),{parserOptions:{delimiter:csv.includes(';')?';':','}});
 }else{
  await book.xlsx.load(file.buffer as any);
 }
 const ws=book.worksheets[0];
 if(!ws)throw new Error('Planilha sem aba de dados');
 const first=ws.getRow(1);
 const columns=new Map<string,number>();
 first.eachCell((c,i)=>columns.set(cell(c.value).toLowerCase().replace(/\s+/g,'_'),i));
 const rows:{line:number;get:(key:string)=>string}[]=[];
 for(let i=2;i<=Math.min(ws.rowCount,1002);i++){
  const row=ws.getRow(i);
  if(!row.hasValues)continue;
  rows.push({line:i,get:(k)=>{const col=columns.get(k);return col?cell(row.getCell(col).value):''}});
 }
 return {rows,columns,truncated:ws.rowCount>1002};
}
function parseOverride(value:string){
 const s=value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(!s)return null;
 if(['off','nao','desativado','0'].includes(s))return {enabled:false};
 const match=s.match(/^(\d{1,3})\s*(d|dias?|s|semanas?|m|mes|meses)$/);
 if(!match)throw new Error('Lembrete inválido: use 1m, 3d, 1s ou off');
 const unit=match[2].startsWith('m')?'months':match[2].startsWith('s')?'weeks':'days';
 const n=Number(match[1]);if(n<1||n>365)throw new Error('Lembrete deve ter 1 a 365 unidades');
 return {enabled:true,offset_value:n,offset_unit:unit};
}
export async function importHandler(req:Request,res:Response,dryRun:boolean){
 if(!req.file) return res.status(400).json({error:'Envie um XLSX ou CSV até 5 MB'});
 const t=await query('select segment,timezone from tenants where id=$1',[req.tenantId]);
 if(!t.rowCount)return res.status(404).json({error:'Ambiente inexistente'});
 const segment=t.rows[0].segment as keyof typeof segments;
 const {rows,columns,truncated}=await readFile(req.file);
 for(const needed of ['nome','whatsapp','tipo_evento','data_evento','consentimento','origem_consentimento']){
  if(!columns.has(needed))return res.status(422).json({error:'Coluna obrigatória ausente: '+needed});
 }
 const failures:{row:number;error:string}[]=[];
 const valid:ImportRow[]=[];
 for(const row of rows){
  try{
   const name=row.get('nome');
   if(name.length<2)throw new Error('Nome obrigatório');
   const phone=phoneE164(row.get('whatsapp'));
   const consent=['sim','true','1','yes'].includes(row.get('consentimento').toLowerCase());
   const consentSource=row.get('origem_consentimento');
   if(!consent||!consentSource)throw new Error('Consentimento e origem obrigatórios');
   const date=parseImportedDate(row.get('data_evento'));
   const time=row.get('hora_evento')||'09:00';
   const startsAt=toUTC(date.includes('T')?date:date+'T'+time,t.rows[0].timezone);
   const title=row.get('tipo_evento');
   if(!title)throw new Error('Tipo do evento obrigatório');
   const fields:Record<string,string>={};
   for(const [key] of segments[segment].fields)if(row.get(key))fields[key]=row.get(key);
   const reminders:Record<string,unknown>={};
   for(let slot=1;slot<=3;slot++){const override=parseOverride(row.get('lembrete_'+slot));if(override)reminders[String(slot)]=override}
   valid.push({name,phone,email:row.get('email'),consent,consentSource,label:row.get('registro')||fields.model||fields.pet_name||title,fields,title,startsAt,reminders:Object.keys(reminders).length?reminders:null});
  }catch(e){failures.push({row:row.line,error:e instanceof Error?e.message:'Linha inválida'})}
 }
 if(dryRun)return res.json({total:rows.length,valid:valid.length,invalid:failures.length,truncated,errors:failures.slice(0,100),preview:valid.slice(0,5)});
 let imported=0,skipped=0;
 for(const row of valid){
  try{
   const contact=await query(
    "insert into contacts(tenant_id,name,phone,email,consent,consent_source,consent_at) values($1,$2,$3,$4,true,$5,now()) on conflict(tenant_id,phone) do update set name=excluded.name,email=excluded.email,updated_at=now() returning id",
    [req.tenantId,row.name,row.phone,row.email||null,row.consentSource]
   );
   const importKey=crypto.createHash('sha256').update([row.phone,row.label,row.title,row.startsAt].join('|')).digest('hex');
   const duplicate=await query('select 1 from events where tenant_id=$1 and import_key=$2',[req.tenantId,importKey]);
   if(duplicate.rowCount){skipped++;continue}
   const record=await query('insert into records(tenant_id,contact_id,label,kind,details) values($1,$2,$3,$4,$5) returning id',[req.tenantId,contact.rows[0].id,row.label,segment,JSON.stringify(row.fields)]);
   const ev=await query('insert into events(tenant_id,contact_id,record_id,title,event_type,starts_at,reminder_overrides,import_key) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[req.tenantId,contact.rows[0].id,record.rows[0].id,row.title,row.title,row.startsAt,row.reminders?JSON.stringify(row.reminders):null,importKey]);
   await rebuildEvent(req.tenantId!,ev.rows[0].id);imported++;
  }catch(e){failures.push({row:imported+2,error:e instanceof Error?e.message:'Falha de persistência'})}
 }
 await query('insert into import_jobs(tenant_id,file_name,imported,rejected,errors) values($1,$2,$3,$4,$5)',[req.tenantId,req.file.originalname,imported,failures.length,JSON.stringify(failures.slice(0,100))]);
 return res.json({total:rows.length,imported,skipped,rejected:failures.length,truncated,errors:failures.slice(0,100)});
}
export async function downloadTemplate(req:Request,res:Response){
 const t=await query('select segment from tenants where id=$1',[req.tenantId]);
 if(!t.rowCount)return res.status(404).json({error:'Ambiente não encontrado'});
 const segment=t.rows[0].segment as keyof typeof segments;
 const book=new ExcelJS.Workbook(),ws=book.addWorksheet('Dados');
 const cols=headers(segment);
 ws.addRow(cols);
 ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF111827'}};
 ws.columns=cols.map(x=>({key:x,width:Math.max(18,x.length+4)}));
 const help=book.addWorksheet('Instruções');
 help.addRows([['BR Notify — modelo '+segments[segment].label],['Uma linha por evento.','Datas: DD/MM/AAAA ou AAAA-MM-DD'],['WhatsApp com DDD:','(19) 99999-9999'],['Consentimento:','SIM, com origem preenchida'],['Três lembretes:','Vazio=padrao; 1m=1 mes; 3d=3 dias; 1s=1 semana; off=desativar']]);
 const buffer=await book.xlsx.writeBuffer();
 res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.setHeader('content-disposition','attachment; filename="brnotify-modelo-'+segment+'.xlsx"');
 return res.send(Buffer.from(buffer));
}
