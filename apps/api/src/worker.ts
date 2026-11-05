import {pool,query} from './db.js';
import {processMessages} from './scheduler.js';
import {rebuildEvent} from './time.js';
import {processOutboundWebhooks,reclaimOutboundAfterCrash} from './outbound-webhooks.js';

let running=true;
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function rebuildRules(){
 const job=await query('select tenant_id,last_event_id from rule_rebuild_queue order by updated_at asc limit 1');
 if(!job.rowCount)return;
 const {tenant_id,last_event_id}=job.rows[0];
 const ids=await query(
  "select id from events where tenant_id=$1 and status='scheduled' and ($2::uuid is null or id>$2) order by id limit 100",
  [tenant_id,last_event_id]
 );
 for(const row of ids.rows)await rebuildEvent(tenant_id,row.id);
 if(ids.rows.length<100)await query('delete from rule_rebuild_queue where tenant_id=$1',[tenant_id]);
 else await query('update rule_rebuild_queue set last_event_id=$2,updated_at=now() where tenant_id=$1',[tenant_id,ids.rows[ids.rows.length-1].id]);
}
let lastMaintenanceAt=0;
async function tick(){
 const now=Date.now();
 // Manutenção/integração no mesmo ritmo anterior; loop rápido somente
 // para mensagens disponíveis depois do intervalo da GoTo.
 if(now-lastMaintenanceAt>=10000){
  lastMaintenanceAt=now;
  // Nunca reprocessa automaticamente um envio aceito/indeterminado após crash.
  await query("update scheduled_messages set status='unknown',error_code='WORKER_INTERRUPTED',error_description='Resultado indeterminado após interrupção do worker',locked_at=null,updated_at=now() where status='processing' and locked_at<now()-interval '3 minutes'");
  await rebuildRules();
  await reclaimOutboundAfterCrash();
  await processOutboundWebhooks();
 }
 await processMessages();
}
async function main(){
 console.log('BR Notify worker iniciado com cadência distribuída');
 while(running){
  try{await tick()}catch(e){console.error('[worker]',e instanceof Error?e.message:'erro')}
  await sleep(800);
 }
 await pool.end();
}
process.on('SIGTERM',()=>{running=false});
process.on('SIGINT',()=>{running=false});
main().catch(e=>{console.error(e);process.exit(1)});
