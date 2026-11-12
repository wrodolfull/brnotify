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
async function lookupSubscription(tenantId:string,accountKey:string,channelId:string,provider:typeof gotoRequest){
 const path='/messaging/v2/subscriptions?'+new URLSearchParams({
  accountKey,ownerEntity:accountKey,ownerEntityType:'ORGANIZATION',channelId
 }).toString();
 return findMatchingSubscription(await provider(tenantId,path),channelId,accountKey);
}

/** Tenant-level PostgreSQL advisory lock prevents parallel clicks from creating duplicate subscriptions. */
export async function activateMessageNotifications(tenantId:string,provider:typeof gotoRequest=gotoRequest){
 const webhook=messageWebhookUrl(env.API_URL,env.GOTO_WEBHOOK_SECRET);
 const lockClient=await pool.connect();
 let locked=false;
 let accountKey:string|null=null;
 let stage='verificar assinatura';
 try{
  const lock=await lockClient.query('select pg_try_advisory_lock(hashtext($1),hashtext($2)) as acquired',['goto-message-notifications',tenantId]);
  locked=lock.rows[0]?.acquired===true;
  if(!locked)throw new ApiOperationError(409,'A ativação já está em andamento neste ambiente.');
  const current=await query(
   'select account_key,from_touchpoint,notification_channel_id from goto_connections where tenant_id=$1',
   [tenantId]);
  const c=current.rows[0];
  if(!c?.account_key||!c?.from_touchpoint)
   throw new ApiOperationError(409,'Conecte a GoTo e salve o Account Key e o remetente WhatsApp antes de ativar.');
  accountKey=String(c.account_key);
  const previousId=String(c.notification_channel_id||'');
  if(CHANNEL_ID.test(previousId)){
   const existing=await lookupSubscription(tenantId,accountKey,previousId,provider);
   if(existing){
    await query(
     'update goto_connections set notification_subscription_id=$2,notification_last_error=null,notification_verified_at=now(),updated_at=now() where tenant_id=$1 and account_key=$3',
     [tenantId,existing.id,accountKey]);
    return {active:true,already_active:true,channel_id:previousId,subscription_id:existing.id};
   }
  }
  stage='criar canal Webhook';
  const channel=await provider(tenantId,'/notification-channel/v1/channels/brnotify-messaging-'+tenantId,{
   method:'POST',json:{channelType:'Webhook',webhookChannelData:{webhook:{url:webhook}},channelLifetime:2147483647}
  }) as {channelId?:string};
  if(!channel?.channelId||!CHANNEL_ID.test(channel.channelId))
   throw new Error('A GoTo não retornou um identificador válido do canal Webhook.');
  const channelId=channel.channelId;
  // A partially completed attempt remains visible and recoverable on the next click.
  const saved=await query(
   'update goto_connections set notification_channel_id=$2,notification_subscription_id=null,notification_last_error=null,notification_verified_at=null,updated_at=now() where tenant_id=$1 and account_key=$3 returning tenant_id',
   [tenantId,channelId,accountKey]);
  if(!saved.rowCount)throw new ApiOperationError(409,'A conexão GoTo mudou durante a ativação.');
  stage='consultar assinaturas';
  const existing=await lookupSubscription(tenantId,accountKey,channelId,provider);
  let subscription=existing;
  if(!subscription){
   stage='assinar eventos INBOUND_MESSAGE e DELIVERY_STATUS';
   const response=await provider(tenantId,'/messaging/v2/subscriptions',{
    method:'POST',json:{accountKey,ownerEntity:accountKey,ownerEntityType:'ORGANIZATION',
     channelId,eventTypes:[...EVENTS]}
   }) as {id?:string};
   if(!response||typeof response.id!=='string'||!response.id.length)
    throw new Error('A GoTo não confirmou o identificador da assinatura.');
   subscription={id:response.id,channelId,eventTypes:[...EVENTS]};
  }
  const updated=await query(
   'update goto_connections set notification_channel_id=$2,notification_subscription_id=$3,notification_last_error=null,notification_verified_at=now(),updated_at=now() where tenant_id=$1 and account_key=$4 returning tenant_id',
   [tenantId,channelId,subscription.id,accountKey]);
  if(!updated.rowCount)throw new ApiOperationError(409,'A conta GoTo mudou durante a ativação.');
  return {active:true,already_active:!!existing,channel_id:channelId,subscription_id:subscription.id};
 }catch(e){
  if(e instanceof ApiOperationError&&[409,422].includes(e.code))throw e;
  const detail=(e instanceof Error?e.message:'Falha desconhecida').slice(0,240);
  const error='Não foi possível '+stage+': '+detail;
  if(accountKey)await query('update goto_connections set notification_last_error=$2,updated_at=now() where tenant_id=$1 and account_key=$3',
   [tenantId,error.slice(0,300),accountKey]);
  // Provider error text is sanitized in gotoRequest; no token, provider raw HTML or webhook URL.
  throw new ApiOperationError(502,error);
 }finally{
  try{if(locked)await lockClient.query('select pg_advisory_unlock(hashtext($1),hashtext($2))',['goto-message-notifications',tenantId]);}
  finally{lockClient.release()}
 }
}
