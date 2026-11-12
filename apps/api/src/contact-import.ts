import ExcelJS from 'exceljs';
import {Readable} from 'node:stream';
import {z} from 'zod';
import type {Request,Response} from 'express';
import {pool,query} from './db.js';
import {phoneE164} from './time.js';
import {ApiOperationError} from './external-operations.js';

export const MAX_CONTACT_IMPORT_ROWS=10000;
const MAX_UPLOAD_BYTES=12*1024*1024;
type ContactRow={line:number;name:string;phone:string;email:string|null;consent:boolean;consentSource:string|null};
type Parsed={rows:ContactRow[];errors:{row:number;error:string}[];total:number;duplicates:number};
const headers=['nome','whatsapp','email','consentimento','origem_consentimento'];
function cell(v:unknown):string{
 if(v===null||v===undefined)return '';
 if(typeof v==='object'&&v!==null){
  if('text' in v)return String((v as {text:unknown}).text||'').trim();
  if('richText' in v)return String((v as {richText:{text:string}[]}).richText.map(x=>x.text).join('')).trim();
  // Do not evaluate formulas, even when the workbook also carries a cached result.
  if('formula' in v)throw new Error('Fórmulas não são permitidas nos dados do contato');
  if('result' in v)return String((v as {result:unknown}).result??'').trim();
  return '';
 }
 return String(v).trim();
}
async function spreadsheet(file:Express.Multer.File):Promise<Parsed>{
 if(!file||file.size>MAX_UPLOAD_BYTES)throw new ApiOperationError(413,'Envie uma planilha XLSX ou CSV com até 12 MB.');
 if(!/\.(xlsx|csv)$/i.test(file.originalname))throw new ApiOperationError(422,'Envie um arquivo XLSX ou CSV.');
 const book=new ExcelJS.Workbook();
 if(/\.csv$/i.test(file.originalname)){
  const csv=file.buffer.toString('utf8').replace(/^\uFEFF/,'');
  const first=(csv.split(/\r?\n/)[0]||'');
  const delimiter=first.includes(';')?';':',';
  await book.csv.read(Readable.from([csv]),{parserOptions:{delimiter}});
 }else await book.xlsx.load(file.buffer as any);
 const sheet=book.worksheets[0];
 if(!sheet)throw new ApiOperationError(422,'Planilha vazia.');
 if(sheet.rowCount>MAX_CONTACT_IMPORT_ROWS+1)
  throw new ApiOperationError(422,'Limite de 10.000 contatos por planilha. Divida o arquivo em partes menores.');
 const col=new Map<string,number>();
 sheet.getRow(1).eachCell((c,i)=>{
  const name=cell(c.value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
  col.set(name,i);
 });
 for(const field of ['nome','whatsapp']){
  if(!col.has(field))throw new ApiOperationError(422,'Coluna obrigatória ausente: '+field);
 }
 const result:Parsed={rows:[],errors:[],total:0,duplicates:0};
 const seen=new Set<string>();
 for(let i=2;i<=sheet.rowCount;i++){
  const row=sheet.getRow(i);
  if(!row.hasValues)continue;
  result.total++;
  try{
   const get=(key:string)=>{const idx=col.get(key);return idx?cell(row.getCell(idx).value):''};
   const name=get('nome');
   if(name==='EXEMPLO - Maria Santos')
    throw new Error('Esta é a linha de exemplo do modelo. Substitua os dados ou exclua a linha antes de importar.');
   const phone=phoneE164(get('whatsapp')),email=get('email');
   if(name.length<2||name.length>180)throw new Error('Nome deve ter entre 2 e 180 caracteres.');
   if(email&&!z.string().email().safeParse(email).success)throw new Error('E-mail inválido.');
   const raw=get('consentimento').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   if(raw&&!['sim','nao','true','false','yes','no','1','0'].includes(raw))
    throw new Error('Consentimento: preencha SIM ou NÃO; vazio é NÃO.');
   const consent=['sim','true','yes','1'].includes(raw);
   const source=get('origem_consentimento');
   if(consent&&(source.length<2||source.length>200))
    throw new Error('Para consentimento SIM, informe a origem real da autorização (2 a 200 caracteres).');
   if(seen.has(phone)){result.duplicates++;continue}
   seen.add(phone);
   result.rows.push({line:i,name,phone,email:email||null,consent,consentSource:consent?source:null});
  }catch(e){
   result.errors.push({row:i,error:e instanceof Error?e.message:'Linha inválida.'});
  }
 }
 if(result.total===0)throw new ApiOperationError(422,'Nenhum contato encontrado na planilha.');
 return result;
}

export async function importContacts(req:Request,res:Response,preview:boolean){
 if(!req.file)return res.status(400).json({error:'Selecione uma planilha XLSX ou CSV.'});
 const parsed=await spreadsheet(req.file);
 const info={
  total:parsed.total,valid:parsed.rows.length,invalid:parsed.errors.length,
  duplicates_in_file:parsed.duplicates,errors:parsed.errors.slice(0,100),
  preview:parsed.rows.slice(0,5).map(({name,phone,email,consent})=>({name,phone,email,consent}))
 };
 if(preview)return res.json(info);
 if(parsed.errors.length)return res.status(422).json({error:'Corrija as linhas inválidas antes da importação.',...info});
 // Each batch is committed atomically. Existing contacts are never overwritten,
 // particularly old opt-outs or inactive records. Do not create appointments.
 let imported=0;
 for(let offset=0;offset<parsed.rows.length;offset+=250){
  const chunk=parsed.rows.slice(offset,offset+250);
  const args:unknown[]=[req.tenantId];
  const slots=chunk.map((r,i)=>{
   const base=2+i*5;
   args.push(r.name,r.phone,r.email,r.consent,r.consentSource);
   return `($1,$${base},$${base+1},$${base+2},$${base+3},$${base+4},case when $${base+3}::boolean then now() else null end)`;
  });
  const result=await query(
   `insert into contacts(tenant_id,name,phone,email,consent,consent_source,consent_at)
    values ${slots.join(',')} on conflict(tenant_id,phone) do nothing returning id`,args);
  imported+=result.rowCount||0;
 }
 res.json({...info,imported,existing:parsed.rows.length-imported,
  notice:'Somente novos contatos foram incluídos. Nenhum compromisso ou WhatsApp foi criado.'});
}
export async function downloadContactsTemplate(_req:Request,res:Response){
 const book=new ExcelJS.Workbook();
 const sheet=book.addWorksheet('Contatos');
 sheet.addRow(headers);
 sheet.addRow(['EXEMPLO - Maria Santos','+5511999999999','maria@exemplo.com','SIM','Autorização presencial (substituir pela origem real)']);
 sheet.columns=headers.map(x=>({width:Math.max(24,x.length+6)}));
 sheet.getColumn(1).width=30;
 sheet.getColumn(5).width=56;
 sheet.views=[{state:'frozen',ySplit:1}];
 const required=new Set(['nome','whatsapp']);
 const hints:Record<string,string>={
  nome:'OBRIGATÓRIO: nome completo, de 2 a 180 caracteres.',
  whatsapp:'OBRIGATÓRIO: número com DDI e DDD. Use um número real do contato.',
  email:'OPCIONAL: e-mail válido, ou deixe em branco.',
  consentimento:'OPCIONAL: SIM quando houver autorização real para WhatsApp; NÃO ou vazio caso contrário.',
  origem_consentimento:'CONDICIONAL: obrigatória quando consentimento for SIM; informe onde e como a autorização foi obtida.'
 };
 headers.forEach((column,index)=>{
  const cell=sheet.getCell(1,index+1);
  cell.font={bold:true,color:{argb:'FFFFFFFF'}};
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:required.has(column)?'FFB91C1C':column==='origem_consentimento'?'FF92400E':'FF111827'}};
  cell.note=hints[column];
 });
 sheet.getRow(1).height=26;
 const example=sheet.getRow(2);
 example.height=26;
 example.font={italic:true,color:{argb:'FF1E40AF'}};
 example.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}};
 const help=book.addWorksheet('Instruções');
 help.addRows([
  ['BR Notify — importação exclusiva de contatos'],
  ['IMPORTANTE','A primeira linha de dados (linha 2) é um EXEMPLO. Substitua ou exclua antes de importar.'],
  ['Cabeçalhos','Mantenha os nomes originais das colunas, sem alterações.'],
  ['Cabeçalho vermelho','Campo OBRIGATÓRIO: nome e whatsapp.'],
  ['Cabeçalho laranja','Campo CONDICIONAL: origem_consentimento, obrigatória quando consentimento=SIM.'],
  ['Cabeçalho escuro','Campo OPCIONAL: email e consentimento.'],
  ['Limite','10.000 contatos por planilha, XLSX ou CSV, até 12 MB'],
  ['nome / whatsapp','Obrigatórios. WhatsApp com DDI e DDD.'],
  ['email','Opcional, formato válido.'],
  ['consentimento','SIM ou NÃO. Vazio significa NÃO.'],
  ['origem_consentimento','Se SIM, registre a origem verdadeira da autorização.'],
  ['Contatos existentes','Ignorados por telefone; opt-out e dados anteriores preservados.'],
  ['Importação','Não cria compromissos nem envia mensagens.']
 ]);
 help.getColumn(1).width=30;
 help.getColumn(2).width=93;
 help.getRow(1).font={bold:true,size:14};
 res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.setHeader('content-disposition','attachment; filename="brnotify-modelo-contatos.xlsx"');
 res.send(Buffer.from(await book.xlsx.writeBuffer()));
}
