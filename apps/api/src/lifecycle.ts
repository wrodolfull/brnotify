import {ApiOperationError,withTransaction} from './external-operations.js';
import {query} from './db.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validIds=(ids:unknown):string[]=>{
 if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||!uuid.test(id))||
    new Set(ids).size!==ids.length)
  throw new ApiOperationError(422,'Selecione entre 1 e 50 registros válidos e sem duplicatas.');
 return ids;
};

/**
 * Prevent deletion/deactivation of a record whose message is currently in
 * provider handoff. A cancelled job may already be accepted by GoTo;
 * never claim to reverse previously sent/delivered messages.
 */
async function assertNoInFlight(
 run:(sql:string,params?:unknown[])=>Promise<any>,tenantId:string,
 contactIds?:string[],eventId?:string
){
 const events=contactIds
  ?await run("select id from events where tenant_id=$1 and contact_id=any($2::uuid[]) for update",[tenantId,contactIds])
  :eventId?await run("select id from events where tenant_id=$1 and id=$2 for update",[tenantId,eventId]):null;
 const ids=events?.rows.map((x:any)=>x.id) as string[]|undefined;
 const scheduled=ids?await run(
  "select id,status from scheduled_messages where tenant_id=$1 and event_id=any($2::uuid[]) and status='processing' for update",
  [tenantId,ids]
 ):await run("select id,status from scheduled_messages where tenant_id=$1 and status='processing' for update",[tenantId]);
 const direct=contactIds?await run(
  "select id,status from on_demand_messages where tenant_id=$1 and contact_id=any($2::uuid[]) and status='processing' for update",
  [tenantId,contactIds]
 ):eventId?{rowCount:0,rows:[]}:await run(
  "select id,status from on_demand_messages where tenant_id=$1 and status='processing' for update",[tenantId]
 );
 if(scheduled.rowCount||direct.rowCount)
  throw new ApiOperationError(409,'Há um disparo em processamento. Aguarde o término antes de excluir ou desativar.');
 return ids||[];
}
const stopQueued=async(run:(sql:string,params?:unknown[])=>Promise<any>,tenantId:string,ids:string[],contactIds?:string[])=>{
 const scheduled=await run(
  "update scheduled_messages set status='cancelled',error_code='RESOURCE_DISABLED',error_description='Cadastro desativado ou excluído',updated_at=now() where tenant_id=$1 and event_id=any($2::uuid[]) and status='scheduled' returning id",
  [tenantId,ids]
 );
 const direct=contactIds?await run(
  "update on_demand_messages set status='cancelled',error_code='CONTACT_DISABLED',error_description='Contato desativado ou excluído',updated_at=now() where tenant_id=$1 and contact_id=any($2::uuid[]) and status='queued' returning id",
  [tenantId,contactIds]
 ):{rowCount:0};
 return {cancelled_reminders:scheduled.rowCount||0,cancelled_direct:direct.rowCount||0};
};

export async function setContactsActive(tenantId:string,rawIds:unknown,active:boolean){
 const ids=validIds(rawIds);
 return withTransaction(async run=>{
  const contacts=await run('select id from contacts where tenant_id=$1 and id=any($2::uuid[]) order by id for update',[tenantId,ids]);
  if(contacts.rowCount!==ids.length)throw new ApiOperationError(404,'Alguns contatos não foram encontrados neste ambiente.');
  const eventIds=active?[]:await assertNoInFlight(run,tenantId,ids);
  const stopped=active?{cancelled_reminders:0,cancelled_direct:0}:await stopQueued(run,tenantId,eventIds,ids);
  const updated=await run(
   "update contacts set is_active=$3,updated_at=now() where tenant_id=$1 and id=any($2::uuid[]) returning id",
   [tenantId,ids,active]
  );
  // Re-activating does not retroactively restore cancelled reminders or change
  // WhatsApp consent. The operator must review affected appointments.
  return {updated:updated.rowCount||0,active,...stopped};
 });
}

export async function removeContacts(tenantId:string,rawIds:unknown){
 const ids=validIds(rawIds);
 return withTransaction(async run=>{
  const contacts=await run('select id from contacts where tenant_id=$1 and id=any($2::uuid[]) order by id for update',[tenantId,ids]);
  if(contacts.rowCount!==ids.length)throw new ApiOperationError(404,'Alguns contatos não foram encontrados neste ambiente.');
  const eventIds=await assertNoInFlight(run,tenantId,ids);
  const stopped=await stopQueued(run,tenantId,eventIds,ids);
  await run("delete from contacts where tenant_id=$1 and id=any($2::uuid[])",[tenantId,ids]);
  return {deleted:ids.length,...stopped,
   notice:'Compromissos, registros e lembretes vinculados foram excluídos. Mensagens já entregues não podem ser revogadas.'};
 });
}

export async function removeEvent(tenantId:string,eventId:string){
 if(!uuid.test(eventId))throw new ApiOperationError(422,'Compromisso inválido');
 return withTransaction(async run=>{
  const selected=await run('select id from events where tenant_id=$1 and id=$2 for update',[tenantId,eventId]);
  if(!selected.rowCount)throw new ApiOperationError(404,'Compromisso não encontrado neste ambiente');
  const ids=await assertNoInFlight(run,tenantId,undefined,eventId);
  const stopped=await stopQueued(run,tenantId,ids);
  // The FK on scheduled_messages is ON DELETE CASCADE; explicitly cancel
  // pending messages before removing the event and its related queue entries.
  await run('delete from events where tenant_id=$1 and id=$2',[tenantId,eventId]);
  return {deleted:true,...stopped,
   notice:'Compromisso excluído e disparos ainda agendados cancelados. Mensagens já enviadas não podem ser desfeitas.'};
 });
}

export async function removeTenant(tenantId:string){
 if(!uuid.test(tenantId))throw new ApiOperationError(422,'Ambiente inválido');
 return withTransaction(async run=>{
  const found=await run('select id,name from tenants where id=$1 for update',[tenantId]);
  if(!found.rowCount)throw new ApiOperationError(404,'Ambiente não encontrado');
  await assertNoInFlight(run,tenantId);
  const workerRuns=await run(
   "select id from automation_runs where tenant_id=$1 and status='processing' for update",[tenantId]
  );
  const outgoing=await run(
   "select id from outbound_webhook_deliveries where tenant_id=$1 and status='processing' for update",[tenantId]
  );
  if(workerRuns.rowCount||outgoing.rowCount)
   throw new ApiOperationError(409,'Existem automações ou webhooks em processamento. Aguarde o término antes de excluir o ambiente.');
  const count=await run("select count(*)::int n from contacts where tenant_id=$1",[tenantId]);
  // All tenant children have cascading FKs. Delete is irreversible.
  const removed=await run('delete from tenants where id=$1 returning id',[tenantId]);
  return {deleted:!!removed.rowCount,contacts_deleted:Number(count.rows[0].n),
   notice:'O ambiente foi excluído com os seus dados. A autorização OAuth e as assinaturas externas devem ser revogadas diretamente na GoTo.'};
 });
}
