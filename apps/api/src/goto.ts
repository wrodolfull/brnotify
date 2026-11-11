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
export const callScopes='cr.v1.read call-events.v1.notifications.manage call-events.v1.events.read';
export function oauthURL(state:string,withCalls=false){
 if(!env.GOTO_CLIENT_ID||!env.GOTO_REDIRECT_URI)throw new Error('Configure o OAuth GoTo no backend');
 const url=new URL('https://authentication.logmeininc.com/oauth/authorize');
 Object.entries({response_type:'code',client_id:env.GOTO_CLIENT_ID,redirect_uri:env.GOTO_REDIRECT_URI,scope:withCalls?scopes+' '+callScopes:scopes,state}).forEach(([k,v])=>url.searchParams.set(k,v));
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
/** Avoid leaking the provider's raw HTML/error body or tenant IDs in logs. */
export function gotoOperation(method:string,path:string){
 const verb=method.toUpperCase();
 if(verb==='POST'&&path.startsWith('/notification-channel/v1/channels/'))return 'criar canal de notificações';
 if(verb==='POST'&&path==='/call-events/v1/subscriptions')return 'assinar eventos de telefonia';
 if(verb==='POST'&&path==='/call-events-report/v1/subscriptions')return 'assinar relatórios de chamadas';
 if(verb==='GET'&&path.startsWith('/call-events-report/v1/reports/'))return 'consultar relatório de chamadas';
 if(verb==='GET'&&path.includes('/message-templates'))return 'sincronizar templates WhatsApp';
 return 'acessar API GoTo';
}
export function describeGotoHttpFailure(method:string,path:string,status:number,contentType:string,body:string,cloudFrontRequestId:string|null=null){
 const step=gotoOperation(method,path);
 const isHtml=/html/i.test(contentType)||/^\s*(?:<!doctype|<html|<head)/i.test(body);
 let code:string|null=null;
 if(!isHtml&&/json/i.test(contentType)){
  try{
   const parsed=JSON.parse(body) as Record<string,unknown>;
   if(typeof parsed.errorCode==='string'&&/^[A-Z0-9_]{2,80}$/.test(parsed.errorCode))code=parsed.errorCode;
  }catch{/* Upstream may return invalid JSON; do not echo it. */}
 }
 const diagnostic=code?' Código GoTo: '+code+'.':
  isHtml?' Resposta HTML do gateway/CDN, sem código JSON da API GoTo.':
  ' Resposta sem código de erro GoTo reconhecido.';
 // This is a provider request identifier, not a credential. Never include body or headers.
 const requestId=cloudFrontRequestId&&/^[A-Za-z0-9_+=/-]{1,150}$/.test(cloudFrontRequestId)?
  ' Referência CDN: '+cloudFrontRequestId+'.':'';
 return 'GoTo HTTP '+status+' ao '+step+'.'+diagnostic+requestId;
}
export async function gotoRequest(tenantId:string,path:string,options:{method?:string;json?:unknown}={}){
 const {token}=await getAccessToken(tenantId);
 const method=options.method||'GET';
 const response=await fetch('https://api.goto.com'+path,{
  method,headers:{authorization:'Bearer '+token,accept:'application/json',...(options.json?{'content-type':'application/json'}:{})},
  body:options.json?JSON.stringify(options.json):undefined,signal:AbortSignal.timeout(20000)
 });
 if(!response.ok){
  const contentType=response.headers.get('content-type')||'';
  const cdnId=response.headers.get('x-amz-cf-id');
  const body=(await response.text()).slice(0,4096);
  const message=describeGotoHttpFailure(method,path,response.status,contentType,body,cdnId);
  console.warn('[GoTo upstream]',JSON.stringify({
   operation:gotoOperation(method,path),method,status:response.status,
   contentType:contentType.slice(0,80),
   responseKind:/html/i.test(contentType)||/^\s*(?:<!doctype|<html|<head)/i.test(body)?'html':'api',
   ...(cdnId&&/^[A-Za-z0-9_+=/-]{1,150}$/.test(cdnId)?{cdnRequestId:cdnId}:{})
  }));
  throw new Error(message);
 }
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
export {buildTemplatePayload,resolveTemplateMediaId,templateFields} from './goto-template.js';
import type {MediaAttachment} from './goto-media.js';
import {retryAfterMilliseconds} from './send-pacing.js';
export function buildMessagingForm(payload:unknown,attachments:MediaAttachment[]=[]){
 const form=new FormData();
 form.append('request',new Blob([JSON.stringify(payload)],{type:'application/json'}),'request.json');
 for(const asset of attachments){
  form.append('attachments',new Blob([new Uint8Array(asset.bytes)],{type:asset.contentType}),asset.filename);
 }
 return form;
}
export class ProviderError extends Error {constructor(public status:number,detail:string,public retryAfterMs:number|null=null){super(detail)}}
export async function sendTemplate(tenantId:string,payload:unknown,attachments:MediaAttachment[]=[]){
 const {token,accountKey}=await getAccessToken(tenantId);
 if(!accountKey)throw new Error('Conta GoTo não configurada');
 const form=buildMessagingForm(payload,attachments);
 let response:Response;
 try{
  response=await fetch('https://api.goto.com/messaging/v2/accounts/'+encodeURIComponent(accountKey)+'/messages',{
   method:'POST',headers:{authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(20000)
  });
 }catch(e){throw new ProviderError(0,'Resultado indeterminado: conexão ou timeout com GoTo')}
 if(!response.ok)throw new ProviderError(response.status,'GoTo HTTP '+response.status+': '+(await response.text()).slice(0,350),retryAfterMilliseconds(response.headers.get('retry-after')));
 let value:{id?:string};
 try{value=await response.json() as {id?:string}}
 catch{throw new ProviderError(0,'Resposta não JSON após envio. Conciliar antes de tentar novamente')}
 if(!value.id)throw new ProviderError(0,'Resposta da GoTo sem ID. Verificar antes de reenviar');
 return value.id;
}
