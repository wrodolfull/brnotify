import crypto from 'node:crypto';
import {env} from './config.js';
import {pool,query} from './db.js';

const KEY=Buffer.from(env.TOKEN_ENCRYPTION_KEY,'hex');
export function encrypt(value:string){
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',KEY,iv);
 const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
}
export function decrypt(value:string){
 const data=Buffer.from(value,'base64'),iv=data.subarray(0,12),tag=data.subarray(12,28);
 const decipher=crypto.createDecipheriv('aes-256-gcm',KEY,iv);decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
}
export const scopes='messaging.v1.send messaging.v1.read messaging.v1.notifications.manage';
export function oauthURL(state:string){
 if(!env.GOTO_CLIENT_ID||!env.GOTO_REDIRECT_URI)throw new Error('Configure o OAuth GoTo no backend');
 const url=new URL('https://authentication.logmeininc.com/oauth/authorize');
 Object.entries({response_type:'code',client_id:env.GOTO_CLIENT_ID,redirect_uri:env.GOTO_REDIRECT_URI,scope:scopes,state}).forEach(([k,v])=>url.searchParams.set(k,v));
 return url.toString();
}
type OAuthTokens={access_token:string;refresh_token?:string;expires_in:number;principal?:string};
export async function exchangeCode(code:string){
 return tokenRequest({grant_type:'authorization_code',code,redirect_uri:env.GOTO_REDIRECT_URI,client_id:env.GOTO_CLIENT_ID});
}
async function tokenRequest(body:Record<string,string>):Promise<OAuthTokens>{
 if(!env.GOTO_CLIENT_ID||!env.GOTO_CLIENT_SECRET)throw new Error('Credenciais OAuth não configuradas');
 const response=await fetch('https://authentication.logmeininc.com/oauth/token',{
  method:'POST',headers:{authorization:'Basic '+Buffer.from(env.GOTO_CLIENT_ID+':'+env.GOTO_CLIENT_SECRET).toString('base64'),'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams(body),signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw new Error('Falha no OAuth GoTo (HTTP '+response.status+')');
 const result=await response.json() as OAuthTokens;
 if(!result.access_token)throw new Error('OAuth retornou token vazio');
 return result;
}
export async function getAccessToken(tenantId:string){
 const client=await pool.connect();
 try{
  await client.query('begin');
  const data=await client.query('select * from goto_connections where tenant_id=$1 for update',[tenantId]);
  if(!data.rowCount)throw new Error('Integração GoTo não conectada');
  const connection=data.rows[0];
  let token=decrypt(connection.access_token_enc);
  if(new Date(connection.expires_at).getTime()<=Date.now()+120000){
   const renewed=await tokenRequest({grant_type:'refresh_token',refresh_token:decrypt(connection.refresh_token_enc)});
   token=renewed.access_token;
   await client.query('update goto_connections set access_token_enc=$2,refresh_token_enc=$3,expires_at=$4,updated_at=now() where tenant_id=$1',[
    tenantId,encrypt(token),encrypt(renewed.refresh_token||decrypt(connection.refresh_token_enc)),new Date(Date.now()+renewed.expires_in*1000)
   ]);
  }
  await client.query('commit');
  return {token,accountKey:connection.account_key as string|null,from:connection.from_touchpoint as string|null};
 }catch(err){await client.query('rollback');throw err}
 finally{client.release()}
}
export async function gotoRequest(tenantId:string,path:string,options:{method?:string;json?:unknown}={}){
 const {token}=await getAccessToken(tenantId);
 const response=await fetch('https://api.goto.com'+path,{
  method:options.method||'GET',headers:{authorization:'Bearer '+token,...(options.json?{'content-type':'application/json'}:{})},
  body:options.json?JSON.stringify(options.json):undefined,signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)throw new Error('GoTo HTTP '+response.status+': '+(await response.text()).slice(0,250));
 return response.status===204?{}:response.json();
}
export async function syncTemplates(tenantId:string){
 const {accountKey,from}=await getAccessToken(tenantId);
 if(!accountKey||!from)throw new Error('Informe Account Key e identificador Meta do WhatsApp');
 const res=await gotoRequest(tenantId,'/messaging/v2/accounts/'+encodeURIComponent(accountKey)+'/message-templates?ownerTouchpoint='+encodeURIComponent(from)) as {items?:Array<Record<string,unknown>>};
 let updated=0;
 for(const item of res.items||[]){
  if(item.channel!=='WHATSAPP')continue;
  await query(
   "insert into message_templates(tenant_id,name,language_code,status,category,definition) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,name,language_code) do update set status=excluded.status,category=excluded.category,definition=excluded.definition,updated_at=now()",
   [tenantId,item.name,item.languageCode,item.status,item.category||'',JSON.stringify(item)]
  );updated++;
 }
 return updated;
}
type Parameter={name:string;value:string};
function getField(path:string,contact:any,event:any,record:any):string{
 const fields:Record<string,unknown>={
  'contact.name':contact.name,'contact.phone':contact.phone,'contact.email':contact.email,
  'event.title':event.title,'event.type':event.event_type,
  'event.date':new Date(event.starts_at).toLocaleDateString('pt-BR',{timeZone:event.timezone||'America/Sao_Paulo'}),
  'event.time':new Date(event.starts_at).toLocaleTimeString('pt-BR',{timeZone:event.timezone||'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})
 };
 if(path.startsWith('record.'))return String(record?.details?.[path.slice(7)]??'');
 if(path.startsWith('contact.custom.'))return String(contact.custom_data?.[path.slice(15)]??'');
 if(path.startsWith('event.custom.'))return String(event.details?.[path.slice(13)]??'');
 return String(fields[path]??'');
}
export function buildTemplatePayload(template:any,contact:any,event:any,record:any,from:string){
 if(template.status!=='APPROVED')throw new Error('Template GoTo não aprovado');
 const mapping=template.variable_map||{};
 const components:any[]=[];
 for(const block of template.definition.components||[]){
  if(!['header','body','footer','buttons'].includes(block.type))throw new Error('Componente de template não suportado');
  const params:Parameter[]=[];
  for(const inner of block.components||[]){
   if(inner.type==='image'||inner.type==='video'||inner.type==='document')throw new Error('Mídia em template não disponível no MVP');
   if(block.type==='buttons'&&(inner.parameters||[]).length)throw new Error('Botão com variáveis não disponível no MVP');
   for(const p of inner.parameters||[]){
    const selector=mapping[p.name];
    if(!selector)throw new Error('Mapeie a variável obrigatória: '+p.name);
    const value=selector.startsWith('literal:')?selector.slice(8):getField(selector,contact,event,record);
    if(!value)throw new Error('Variável sem valor: '+p.name);
    params.push({name:p.name,value});
   }
  }
  if(params.length)components.push({type:block.type,parameters:params});
 }
 return {channel:'WHATSAPP',from,to:[contact.phone],type:'template',attributes:{name:template.name,languageCode:template.language_code},components};
}
export class ProviderError extends Error {constructor(public status:number,detail:string){super(detail)}}
export async function sendTemplate(tenantId:string,payload:unknown){
 const {token,accountKey}=await getAccessToken(tenantId);
 if(!accountKey)throw new Error('Conta GoTo não configurada');
 const form=new FormData();
 form.append('request',new Blob([JSON.stringify(payload)],{type:'application/json'}));
 let response:Response;
 try{
  response=await fetch('https://api.goto.com/messaging/v2/accounts/'+encodeURIComponent(accountKey)+'/messages',{
   method:'POST',headers:{authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(20000)
  });
 }catch(e){throw new ProviderError(0,'Resultado indeterminado: conexão ou timeout com GoTo')}
 if(!response.ok)throw new ProviderError(response.status,'GoTo HTTP '+response.status+': '+(await response.text()).slice(0,350));
 const value=await response.json() as {id?:string};
 if(!value.id)throw new ProviderError(0,'Resposta da GoTo sem ID. Verificar antes de reenviar');
 return value.id;
}
