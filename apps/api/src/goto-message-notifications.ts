import {pool,query} from './db.js';
import {env} from './config.js';
import {gotoRequest} from './goto.js';
import {ApiOperationError} from './external-operations.js';

const EVENTS=['INBOUND_MESSAGE','DELIVERY_STATUS'] as const;
const CHANNEL_ID=/^Webhook\.[A-Za-z0-9-]{20,100}$/;
type Subscription={id:string;channelId:string;eventTypes:string[];ownerEntity?:string;ownerEntityType?:string};

/** Only the backend selects the public callback; never accept a frontend-supplied URL. */
export function messageWebhookUrl(apiUrl:string,secret:string){
 if(secret.length<24)throw new ApiOperationError(422,'Configure GOTO_WEBHOOK_SECRET com ao menos 24 caracteres no .env da API.');
 const url=new URL(apiUrl);
 if(url.protocol!=='https:'||!url.hostname||['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname))
  throw new ApiOperationError(422,'Configure API_URL com o domínio público HTTPS da API (não localhost).');
 return url.origin+'/api/webhooks/goto/'+encodeURIComponent(secret);
}
export function findMatchingSubscription(response:unknown,channelId:string,accountKey:string):Subscription|null{
 const data=response as {items?:unknown};
 if(!data||!Array.isArray(data.items))
  throw new Error('A GoTo não retornou uma lista de assinaturas reconhecível.');
 const item=data.items.find((value:unknown)=>{
  const v=value as Partial<Subscription>;
  return v&&typeof v.id==='string'&&v.id.length>0&&v.channelId===channelId
   &&(!v.ownerEntity||v.ownerEntity===accountKey)
   &&(!v.ownerEntityType||v.ownerEntityType==='ORGANIZATION')
   &&Array.isArray(v.eventTypes)&&EVENTS.every(event=>v.eventTypes!.includes(event));
 }) as Subscription|undefined;
 return item||null;
}
export async function messageNotificationStatus(tenantId:string){
 const [connection,received]=await Promise.all([
  query('select account_key,from_touchpoint,notification_channel_id,notification_subscription_id,notification_last_error,notification_verified_at from goto_connections where tenant_id=$1',[tenantId]),
  query("select occurred_at from integration_events where tenant_id=$1 and event_type='message.received' and metadata->>'channel'='WHATSAPP' order by occurred_at desc limit 1",[tenantId])
 ]);
 const c=connection.rows[0];
 let webhookReady=false;
 try{messageWebhookUrl(env.API_URL,env.GOTO_WEBHOOK_SECRET);webhookReady=true}catch{}
 return {connected:!!c,account_configured:!!c?.account_key,sender_configured:!!c?.from_touchpoint,
  webhook_ready:webhookReady,channel_configured:!!c?.notification_channel_id,
  subscription_configured:!!c?.notification_subscription_id,
  last_error:c?.notification_last_error||null,
  last_configured_at:c?.notification_verified_at||null,
  last_received_at:received.rows[0]?.occurred_at||null};
}
/** The GoTo search endpoint returns subscriptions of the authenticated OAuth user only.
 * Check the whole organization before POST; filtering by the new channel misses older subscriptions.
 */
async function searchSubscriptions(tenantId:string,accountKey:string,provider:typeof gotoRequest):Promise<Subscription[]>{
 const items:Subscription[]=[];
 const markers=new Set<string>();
 let marker:string|null=null;
 for(let page=0;page<10;page++){
  const params=new URLSearchParams({accountKey,ownerEntity:accountKey,ownerEntityType:'ORGANIZATION',pageSize:'100'});
  if(marker)params.set('pageMarker',marker);
  const response=await provider(tenantId,'/messaging/v2/subscriptions?'+params.toString()) as {items?:unknown;nextPageMarker?:unknown};
  if(!response||!Array.isArray(response.items))
   throw new Error('A GoTo não retornou uma lista de assinaturas reconhecível.');
  for(const x of response.items){
   const v=x as Partial<Subscription>;
   if(v&&typeof v.id==='string'&&typeof v.channelId==='string'&&
     v.ownerEntity===accountKey&&v.ownerEntityType==='ORGANIZATION'&&Array.isArray(v.eventTypes))
     items.push(v as Subscription);
  }
  if(!response.nextPageMarker||typeof response.nextPageMarker!=='string')return items;
  if(markers.has(response.nextPageMarker))throw new Error('Paginação de assinaturas inconsistente na GoTo.');
  markers.add(response.nextPageMarker);
  marker=response.nextPageMarker;
 }
 throw new Error('Muitas assinaturas para verificar automaticamente. Verifique a GoTo.');
}
function complete(sub:Subscription){return EVENTS.every(e=>sub.eventTypes.includes(e))}
function existingConflict(subs:Subscription[],preferredChannel:string|null){
 const same=subs.find(x=>x.channelId===preferredChannel);
 if(same&&!complete(same))
  return 'Existe uma assinatura incompleta nesse canal. Revise os eventos cadastrados na GoTo antes de reativar.';
 if(subs.some(x=>complete(x)&&x.channelId!==preferredChannel))
  return 'A conta GoTo já possui uma assinatura de mensagens em outro canal. Para evitar interrupção de eventos, a assinatura existente não será substituída automaticamente. Verifique a configuração atual na GoTo.';
 return null;
}

/** Prevent duplicate subscriptions and preserve previous channel IDs after a 409. */
export async function activateMessageNotifications(tenantId:string,provider:typeof gotoRequest=gotoRequest){
 const webhook=messageWebhookUrl(env.API_URL,env.GOTO_WEBHOOK_SECRET);
 const lockClient=await pool.connect();
 let locked=false;
 let accountKey:string|null=null;
 let stage='verificar assinaturas existentes';
 try{
  const lock=await lockClient.query('select pg_try_advisory_lock(hashtext($1),hashtext($2)) as acquired',['goto-message-notifications',tenantId]);
  locked=lock.rows[0]?.acquired===true;
  if(!locked)throw new ApiOperationError(409,'A ativação já está em andamento neste ambiente.');
  const current=await query(
   'select account_key,from_touchpoint,notification_channel_id,notification_subscription_id from goto_connections where tenant_id=$1',
   [tenantId]);
  const c=current.rows[0];
  if(!c?.account_key||!c?.from_touchpoint)
   throw new ApiOperationError(409,'Conecte a GoTo e salve o Account Key e o remetente WhatsApp antes de ativar.');
  accountKey=String(c.account_key);
  const preferredChannel=typeof c.notification_channel_id==='string'&&CHANNEL_ID.test(c.notification_channel_id)?c.notification_channel_id:null;
  let subscriptions=await searchSubscriptions(tenantId,accountKey,provider);
  const existing=preferredChannel?subscriptions.find(x=>x.channelId===preferredChannel&&complete(x)):null;
  if(existing){
   await query(
    'update goto_connections set notification_subscription_id=$2,notification_last_error=null,notification_verified_at=now(),updated_at=now() where tenant_id=$1 and account_key=$3',
    [tenantId,existing.id,accountKey]);
   return {active:true,already_active:true,channel_id:existing.channelId,subscription_id:existing.id};
  }
  const conflict=existingConflict(subscriptions,preferredChannel);
  if(conflict)throw new ApiOperationError(409,conflict);
  let channelId=preferredChannel;
  if(!channelId){
   stage='criar canal Webhook';
   const channel=await provider(tenantId,'/notification-channel/v1/channels/brnotify-messaging-'+tenantId,{
    method:'POST',json:{channelType:'Webhook',webhookChannelData:{webhook:{url:webhook}},channelLifetime:2147483647}
   }) as {channelId?:string};
   if(!channel?.channelId||!CHANNEL_ID.test(channel.channelId))
    throw new Error('A GoTo não retornou um identificador válido do canal Webhook.');
   channelId=channel.channelId;
   // Persist once created, even if subscription registration subsequently fails.
   const saved=await query(
    'update goto_connections set notification_channel_id=$2,notification_subscription_id=null,notification_last_error=null,notification_verified_at=null,updated_at=now() where tenant_id=$1 and account_key=$3 returning tenant_id',
    [tenantId,channelId,accountKey]);
   if(!saved.rowCount)throw new ApiOperationError(409,'A conexão GoTo foi alterada durante a ativação.');
  }
  stage='assinar eventos de mensagens';
  let subscriptionId:string|null=null;
  try{
   const response=await provider(tenantId,'/messaging/v2/subscriptions',{
    method:'POST',json:{accountKey,ownerEntity:accountKey,ownerEntityType:'ORGANIZATION',channelId,eventTypes:[...EVENTS]}
   }) as {id?:unknown};
   if(typeof response?.id!=='string'||!response.id)
    throw new Error('A GoTo não confirmou o ID da assinatura.');
   subscriptionId=response.id;
  }catch(e){
   // A provider conflict might mean a previous POST was committed despite a lost response.
   if(!/GoTo HTTP 409/.test(e instanceof Error?e.message:''))throw e;
   subscriptions=await searchSubscriptions(tenantId,accountKey,provider);
   const found=subscriptions.find(x=>x.channelId===channelId&&complete(x));
   if(found)subscriptionId=found.id;
   else throw new ApiOperationError(409,existingConflict(subscriptions,channelId)||
    'A GoTo informou conflito de assinatura, mas não retornou uma assinatura reutilizável. Verifique as assinaturas do usuário Super Admin conectado, sem criar novas assinaturas.');
  }
  const updated=await query(
   'update goto_connections set notification_channel_id=$2,notification_subscription_id=$3,notification_last_error=null,notification_verified_at=now(),updated_at=now() where tenant_id=$1 and account_key=$4 returning tenant_id',
   [tenantId,channelId,subscriptionId,accountKey]);
  if(!updated.rowCount)throw new ApiOperationError(409,'A conta GoTo mudou durante a ativação.');
  return {active:true,already_active:false,channel_id:channelId,subscription_id:subscriptionId};
 }catch(e){
  const detail=(e instanceof Error?e.message:'Falha desconhecida').slice(0,255);
  const error=e instanceof ApiOperationError?detail:'Não foi possível '+stage+': '+detail;
  if(accountKey)await query('update goto_connections set notification_last_error=$2,updated_at=now() where tenant_id=$1 and account_key=$3',
   [tenantId,error.slice(0,300),accountKey]);
  if(e instanceof ApiOperationError)throw e;
  throw new ApiOperationError(502,error);
 }finally{
  try{if(locked)await lockClient.query('select pg_advisory_unlock(hashtext($1),hashtext($2))',['goto-message-notifications',tenantId]);}
  finally{lockClient.release()}
 }
}
