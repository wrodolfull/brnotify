import {z} from 'zod';
import {normalizeWhatsAppPhone} from './whatsapp-phone.js';

type RecordData=Record<string,any>;
export type WhatsAppTemplate={
 name:string;language_code:string;status:string;
 definition:RecordData;variable_map:Record<string,string>|null
};
export type TemplateContext={
 contact:RecordData;event:RecordData;record:RecordData|null
};
export type MediaRequirement={assetId:string;kind:'image'|'video'|'document'};
const mediaKinds=new Set(['image','video','document']);
const validId=z.string().uuid();

export function templateFields(definition:RecordData):Array<{
 key:string;label:string;name:string;example:string;kind:'text'|'media'|'button'
}>{
 const fields:Array<{key:string;label:string;name:string;example:string;kind:'text'|'media'|'button'}>=[];
 for(const block of definition?.components||[]){
  if(block.type==='header'){
   for(const inner of block.components||[]){
    if(mediaKinds.has(inner.type)){
     fields.push({key:'header.media',label:'Cabeçalho · '+inner.type,name:'header.media',example:'',kind:'media'});
    }
   }
  }
  for(const [index,inner] of (block.components||[]).entries()){
   for(const param of inner.parameters||[]){
    if(!param.name)continue;
    const key=block.type==='buttons'?'buttons.'+index+'.'+param.name:block.type+'.'+param.name;
    fields.push({
     key,label:(block.type==='buttons'?'Botão '+(index+1):block.type)+' · '+param.name,
     name:String(param.name),example:String(param.example??''),
     kind:block.type==='buttons'?'button':'text'
    });
   }
  }
 }
 return fields;
}
export function fieldValue(selector:string,ctx:TemplateContext):string{
 if(selector.startsWith('literal:'))return selector.slice('literal:'.length);
 const {contact,event,record}=ctx;
 const fields:Record<string,unknown>={
  'contact.name':contact.name,'contact.phone':contact.phone,'contact.email':contact.email,
  'event.title':event.title,'event.type':event.event_type,
  'event.date':new Date(event.starts_at).toLocaleDateString('pt-BR',{timeZone:event.timezone||'America/Sao_Paulo'}),
  'event.time':new Date(event.starts_at).toLocaleTimeString('pt-BR',{timeZone:event.timezone||'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})
 };
 if(selector.startsWith('record.'))return String(record?.details?.[selector.slice(7)]??'');
 if(selector.startsWith('contact.custom.'))return String(contact.custom_data?.[selector.slice(15)]??'');
 if(selector.startsWith('event.custom.'))return String(event.details?.[selector.slice(13)]??'');
 return String(fields[selector]??'');
}
function valueOf(key:string,legacyName:string,mapping:Record<string,string>,ctx:TemplateContext){
 const selector=mapping[key]||mapping[legacyName];
 if(!selector)throw new Error('Mapeie a variável obrigatória: '+key);
 const value=fieldValue(selector,ctx);
 if(!value.trim())throw new Error('Variável sem valor: '+key);
 if(value.length>4096)throw new Error('Variável muito longa: '+key);
 return value;
}
export function resolveTemplateMediaId(template:WhatsAppTemplate,ctx:TemplateContext):MediaRequirement|null{
 let type:MediaRequirement['kind']|null=null;
 for(const block of template.definition?.components||[]){
  if(block.type==='header'){
   for(const inner of block.components||[]){
    if(mediaKinds.has(inner.type)){
     if(type)throw new Error('Template com mais de uma mídia no cabeçalho não suportado');
     type=inner.type as MediaRequirement['kind'];
    }
   }
  }
 }
 if(!type)return null;
 const selector=template.variable_map?.['header.media'];
 if(!selector)throw new Error('Selecione uma mídia para o cabeçalho deste template');
 let candidate:string;
 if(selector.startsWith('asset:'))candidate=selector.slice(6);
 else candidate=fieldValue(selector,ctx);
 const assetId=validId.safeParse(candidate.trim());
 if(!assetId.success)throw new Error('O cabeçalho precisa referenciar um ID de mídia válido do ambiente');
 return {assetId:assetId.data,kind:type};
}
export function buildTemplatePayload(
 template:WhatsAppTemplate,contact:RecordData,event:RecordData,record:RecordData|null,
 from:string,mediaFilename?:string
){
 if(template.status!=='APPROVED')throw new Error('Template GoTo não aprovado');
 const ctx={contact,event,record};
 const mapping=template.variable_map||{};
 const components:RecordData[]=[];
 for(const block of template.definition?.components||[]){
  if(!['header','body','footer','buttons'].includes(block.type))
   throw new Error('Tipo de componente GoTo não reconhecido: '+block.type);
  const params:{name:string;value:string}[]=[];
  const childComponents:RecordData[]=[];
  for(const [index,inner] of (block.components||[]).entries()){
   if(mediaKinds.has(inner.type)){
    if(block.type!=='header')throw new Error('Mídia de template fora do cabeçalho não suportada');
    if(!mediaFilename)throw new Error('Arquivo exigido pelo cabeçalho não foi carregado');
    childComponents.push({type:inner.type,attributes:{attachmentName:mediaFilename}});
    continue;
   }
   if(block.type==='buttons'&&inner.type!=='button')
    throw new Error('Tipo de botão não suportado: '+inner.type);
   if(block.type!=='buttons'&&inner.type!=='text')
    throw new Error('Componente de template não suportado: '+inner.type);
   const current=(inner.parameters||[]).map((param:any)=>{
    if(typeof param.name!=='string')throw new Error('Parâmetro de template sem nome');
    const key=block.type==='buttons'?'buttons.'+index+'.'+param.name:block.type+'.'+param.name;
    return {name:param.name,value:valueOf(key,param.name,mapping,ctx)};
   });
   if(block.type==='buttons'){
    if(current.length)childComponents.push({type:'button',parameters:current});
   }else params.push(...current);
  }
  if(params.length||childComponents.length)components.push({
   type:block.type,...(params.length?{parameters:params}:{}),
   ...(childComponents.length?{components:childComponents}:{})
  });
 }
 return {
  channel:'WHATSAPP',from,to:[normalizeWhatsAppPhone(contact.phone)],type:'template',
  attributes:{name:template.name,languageCode:template.language_code},
  ...(components.length?{components}:{})
 };
}
