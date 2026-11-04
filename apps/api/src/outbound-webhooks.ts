import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import {BlockList,isIP} from 'node:net';
import {query} from './db.js';
import {decrypt} from './goto.js';

export class WebhookConfigurationError extends Error {
 constructor(message:string){super(message)}
}
export const WEBHOOK_EVENT_TYPES=[
 'reminder.sent','reminder.delivered','reminder.failed',
 'event.cancelled','appointment.confirmed',
 'appointment.reschedule_requested','appointment.declined'
] as const;

const blacklist=new BlockList();
for(const [range,prefix] of [
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],
 ['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
 ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
 ['224.0.0.0',4],['240.0.0.0',4]
] as const)blacklist.addSubnet(range,prefix,'ipv4');
for(const [range,prefix] of [
 ['::',128],['::1',128],['fc00::',7],['fe80::',10],
 ['2001:db8::',32],['::ffff:0:0',96]
] as const)blacklist.addSubnet(range,prefix,'ipv6');

export function isSafePublicAddress(address:string,family:4|6):boolean{
 if(isIP(address)!==family)return false;
 return !blacklist.check(address,family===4?'ipv4':'ipv6');
}
export function parseWebhookUrl(input:string):URL{
 const u=new URL(input);
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.hash)
  throw new WebhookConfigurationError('O webhook exige HTTPS, porta 443 e URL sem credenciais ou fragmento');
 const host=u.hostname.toLowerCase();
 if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')
  ||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')
  ||host.endsWith('.invalid')||isIP(host))
  throw new WebhookConfigurationError('Use um hostname público, nunca IP local ou domínio interno');
 if(u.href.length>1024)throw new WebhookConfigurationError('URL muito longa');
 return u;
}
export async function assertSafeWebhookUrl(input:string){
 const url=parseWebhookUrl(input);
 const ips=await dns.lookup(url.hostname,{all:true,verbatim:true});
 if(!ips.length || !ips.every(v=>isSafePublicAddress(v.address,v.family as 4|6)))
  throw new WebhookConfigurationError('O DNS do webhook deve resolver somente para endereços públicos');
 return {url,address:ips[0].address,family:ips[0].family as 4|6};
}
export function signWebhook(secret:string,timestamp:string,json:string){
 return 'sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.'+json).digest('hex');
}
export type OutboundTransport=(
 url:string,body:string,secret:string,eventId:string,deliveryId:string
)=>Promise<number>;
export const sendWebhook:OutboundTransport=async(urlString,body,secret,eventId,deliveryId)=>{
 const {url,address,family}=await assertSafeWebhookUrl(urlString);
 const timestamp=String(Math.floor(Date.now()/1000));
 const signature=signWebhook(secret,timestamp,body);
 return new Promise<number>((resolve,reject)=>{
  const request=https.request({
   hostname:url.hostname,port:443,path:url.pathname+url.search,method:'POST',
   servername:url.hostname,timeout:8000,
   lookup:(_hostname,_opts,cb)=>{cb(null,address,family)},
   headers:{
    'content-type':'application/json',
    'content-length':Buffer.byteLength(body),
    'user-agent':'BRNotify-Webhooks/1.0',
    'x-brnotify-event':eventId,
    'x-brnotify-delivery':deliveryId,
    'x-brnotify-timestamp':timestamp,
    'x-brnotify-signature':signature
   }
  },response=>{
   response.resume();
   response.once('end',()=>resolve(response.statusCode||0));
  });
  request.once('timeout',()=>request.destroy(new Error('Timeout de webhook')));
  request.once('error',reject);
  request.end(body);
 });
};
export async function processOutboundWebhooks(transport:OutboundTransport=sendWebhook){
 const claimed=await query(
  "with due as (select d.id from outbound_webhook_deliveries d join outbound_webhook_endpoints e on e.id=d.endpoint_id and e.tenant_id=d.tenant_id join tenants t on t.id=d.tenant_id where d.status='queued' and d.next_attempt_at<=now() and t.status='active' order by d.next_attempt_at,id for update of d skip locked limit 20) update outbound_webhook_deliveries d set status='processing',attempts=attempts+1,locked_at=now() from due where d.id=due.id returning d.*"
 );
 for(const row of claimed.rows){
  let status=0,reason='';
  try{
   const ep=await query(
    'select destination_url,signing_secret_enc,active from outbound_webhook_endpoints where id=$1 and tenant_id=$2',
    [row.endpoint_id,row.tenant_id]
   );
   if(!ep.rowCount || !ep.rows[0].active)throw new Error('Endpoint desativado');
   status=await transport(
    ep.rows[0].destination_url,JSON.stringify(row.payload),
    decrypt(ep.rows[0].signing_secret_enc),row.event_id,row.id
   );
   if(status>=200&&status<300){
    await query("update outbound_webhook_deliveries set status='delivered',delivered_at=now(),last_status_code=$2,last_error=null,locked_at=null where id=$1",[row.id,status]);
    continue;
   }
   reason='HTTP '+status;
  }catch(e){reason=e instanceof Error?e.message:'Falha de rede'}
  const retryable=!(status>=400&&status<500&&status!==408&&status!==429);
  const shouldRetry=retryable&&row.attempts<8;
  const delay=Math.min(3600,Math.pow(2,row.attempts)*15);
  await query(
   "update outbound_webhook_deliveries set status=$2,next_attempt_at=case when $3 then now()+($4::int*interval '1 second') else next_attempt_at end,last_status_code=$5,last_error=$6,locked_at=null where id=$1",
   [row.id,shouldRetry?'queued':'dead',shouldRetry,delay,status||null,reason.slice(0,300)]
  );
 }
 return claimed.rowCount||0;
}
export async function reclaimOutboundAfterCrash(){
 // Webhooks têm semântica "pelo menos uma vez"; receptores devem deduplicar por id.
 await query("update outbound_webhook_deliveries set status='queued',locked_at=null,next_attempt_at=now() where status='processing' and locked_at<now()-interval '2 minutes'");
}
