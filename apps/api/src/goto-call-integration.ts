import crypto from 'node:crypto';
import {env} from './config.js';
import {gotoRequest} from './goto.js';
import {query} from './db.js';

export async function activateCallMonitoring(tenantId:string){
 const conn=await query(
  'select account_key,call_scopes_granted from goto_connections where tenant_id=$1',
  [tenantId]
 );
 if(!conn.rowCount||!conn.rows[0].account_key)
  throw new Error('Configure a conta GoTo antes de ativar o monitoramento.');
 if(!conn.rows[0].call_scopes_granted)
  throw new Error('Autorize a GoTo novamente com as permissões de telefonia.');
 if(env.NODE_ENV==='production'&&!env.API_URL.startsWith('https://'))
  throw new Error('A URL pública da API deve usar HTTPS.');
 const current=await query('select enabled,channel_id from goto_call_monitors where tenant_id=$1',[tenantId]);
 if(current.rows[0]?.enabled)return {active:true,channel_id:current.rows[0].channel_id,already_active:true};
 const accountKey=conn.rows[0].account_key as string;
 const secret=crypto.randomBytes(32).toString('hex');
 const secretHash=crypto.createHash('sha256').update(secret).digest('hex');
 // Persist the verifier before registering the channel to allow the provider's handshake.
 await query(
  `insert into goto_call_monitors(tenant_id,webhook_secret_hash,enabled,state_subscribed,report_subscription_id,channel_id,last_error)
   values($1,$2,false,false,null,null,null)
   on conflict(tenant_id) do update set webhook_secret_hash=excluded.webhook_secret_hash,
    enabled=false,state_subscribed=false,report_subscription_id=null,channel_id=null,last_error=null,updated_at=now()`,
  [tenantId,secretHash]
 );
 try{
  const webhook=env.API_URL.replace(/\/$/,'')+'/api/webhooks/goto-calls/'+tenantId+'/'+secret;
  const channel=await gotoRequest(tenantId,'/notification-channel/v1/channels/brnotify-'+tenantId.slice(0,20)+'-'+crypto.randomBytes(4).toString('hex'),{
   method:'POST',json:{channelType:'Webhook',webhookChannelData:{webhook:{url:webhook}}}
  }) as {channelId?:string};
  if(!channel.channelId)throw new Error('A GoTo não retornou o identificador do canal de notificações.');
  const channelId=channel.channelId;
  await query('update goto_call_monitors set channel_id=$2,updated_at=now() where tenant_id=$1',[tenantId,channelId]);
  const state=await gotoRequest(tenantId,'/call-events/v1/subscriptions',{
   method:'POST',json:{channelId,accountKeys:[{id:accountKey,events:['STARTING','ACTIVE','ENDING']}]}
  }) as {accountKeys?:Array<{id:string;status:number}>};
  if(!state.accountKeys?.some(x=>x.id===accountKey&&x.status>=200&&x.status<300))
   throw new Error('A assinatura de estados de chamada não foi confirmada pela GoTo.');
  await query('update goto_call_monitors set state_subscribed=true,updated_at=now() where tenant_id=$1',[tenantId]);
  const reports=await gotoRequest(tenantId,'/call-events-report/v1/subscriptions',{
   method:'POST',json:{channelId,eventTypes:['REPORT_SUMMARY'],accountKeys:[accountKey]}
  }) as {items?:Array<{id:string}>};
  const reportSubscriptionId=reports.items?.[0]?.id;
  if(!reportSubscriptionId)throw new Error('A GoTo não confirmou a assinatura de relatórios de chamadas.');
  await query('update goto_call_monitors set enabled=true,report_subscription_id=$2,last_error=null,updated_at=now() where tenant_id=$1',
   [tenantId,reportSubscriptionId]);
  return {active:true,channel_id:channelId,already_active:false};
 }catch(e){
  await query('update goto_call_monitors set last_error=$2,updated_at=now() where tenant_id=$1',
   [tenantId,(e instanceof Error?e.message:'Falha desconhecida').slice(0,220)]);
  throw e;
 }
}

export async function callMonitorStatus(tenantId:string){
 const [monitor,connection]=await Promise.all([
  query('select enabled,channel_id,state_subscribed,report_subscription_id,last_error,updated_at from goto_call_monitors where tenant_id=$1',[tenantId]),
  query('select account_key,call_scopes_granted from goto_connections where tenant_id=$1',[tenantId])
 ]);
 return {active:monitor.rows[0]?.enabled===true,
  call_scopes_granted:connection.rows[0]?.call_scopes_granted===true,
  account_configured:!!connection.rows[0]?.account_key,
  channel_configured:!!monitor.rows[0]?.channel_id,
  state_subscribed:monitor.rows[0]?.state_subscribed===true,
  report_subscribed:!!monitor.rows[0]?.report_subscription_id,
  last_error:monitor.rows[0]?.last_error||null,
  updated_at:monitor.rows[0]?.updated_at||null
 };
}
