import {ApiOperationError,withTransaction} from './external-operations.js';

/**
 * Disconnects THIS tenant only, even when GoTo's API is unavailable (403).
 * Stop pending actions and remove encrypted local OAuth credentials atomically.
 * Does not pretend to revoke the grant on the GoTo provider's OAuth server.
 */
export async function disconnectGotoTenant(tenantId:string,actorId:string){
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1))',['automations:'+tenantId]);
  const conn=await run(
   'select tenant_id from goto_connections where tenant_id=$1 for update',[tenantId]
  );
  if(!conn.rowCount)throw new ApiOperationError(404,'Este ambiente não possui conexão GoTo ativa.');
  // Fail closed for operations which may already be interacting with GoTo.
  // Never mark a provider submission as cancelled if its result is unknown.
  const scheduled=await run(
   "select id,status from scheduled_messages where tenant_id=$1 and status in ('scheduled','processing') for update",
   [tenantId]
  );
  const onDemand=await run(
   "select id,status from on_demand_messages where tenant_id=$1 and status in ('queued','processing') for update",
   [tenantId]
  );
  const flows=await run(
   'select id,status from automation_flows where tenant_id=$1 for update',[tenantId]
  );
  const runs=await run(
   "select id,status from automation_runs where tenant_id=$1 and status in ('pending','processing') for update",
   [tenantId]
  );
  const webhooks=await run(
   "select id,status from outbound_webhook_deliveries where tenant_id=$1 and event_type='automation.triggered' and status in ('queued','processing') for update",
   [tenantId]
  );
  if(scheduled.rows.some(x=>x.status==='processing')||
     onDemand.rows.some(x=>x.status==='processing')||
     runs.rows.some(x=>x.status==='processing')||
     webhooks.rows.some(x=>x.status==='processing'))
   throw new ApiOperationError(409,
    'Há envios ou automações em processamento. Aguarde a conclusão antes de desconectar para evitar resultados indeterminados.');
  const messages=await run(
   `update scheduled_messages set status='cancelled',error_code='GOTO_DISCONNECTED',
    error_description='GoTo desconectada pelo administrador',updated_at=now()
    where tenant_id=$1 and status='scheduled' returning id`,[tenantId]
  );
  const direct=await run(
   `update on_demand_messages set status='cancelled',error_code='GOTO_DISCONNECTED',
    error_description='GoTo desconectada pelo administrador',updated_at=now()
    where tenant_id=$1 and status='queued' returning id`,[tenantId]
  );
  const pending=await run(
   `update automation_runs set status='cancelled',reason='GoTo desconectada',
    finished_at=now() where tenant_id=$1 and status='pending' returning id`,[tenantId]
  );
  await run(
   `update outbound_webhook_deliveries set status='dead',last_error='GoTo desconectada'
    where tenant_id=$1 and event_type='automation.triggered' and status='queued'`,[tenantId]
  );
  await run(
   `update automation_flows set status='paused',revision=revision+1,
    last_error=null,updated_at=now()
    where tenant_id=$1 and status='active'`,[tenantId]
  );
  // Removes the webhook secret alongside subscriptions. Existing
  // historical call events and templates remain for auditing.
  await run('delete from goto_call_monitors where tenant_id=$1',[tenantId]);
  await run('delete from oauth_states where tenant_id=$1',[tenantId]);
  // Finally destroy encrypted access and refresh tokens.
  await run('delete from goto_connections where tenant_id=$1',[tenantId]);
  await run(
   `insert into audit_logs(tenant_id,user_id,action,detail)
    values($1,$2,'goto.disconnected',$3)`,
   [tenantId,actorId,JSON.stringify({
    cancelled_reminders:messages.rowCount||0,cancelled_direct:direct.rowCount||0,
    cancelled_automation_runs:pending.rowCount||0,paused_flows:flows.rows.filter(x=>x.status==='active').length
   })]
  );
  return {
   disconnected:true,
   cancelled_reminders:messages.rowCount||0,
   cancelled_direct:direct.rowCount||0,
   cancelled_automation_runs:pending.rowCount||0,
   paused_flows:flows.rows.filter(x=>x.status==='active').length,
   provider_authorization_revoked:false,
   notice:'Conexão removida do BR Notify. Para revogar também a autorização OAuth na GoTo, remova o acesso no portal da GoTo. Assinaturas externas podem exigir remoção na conta GoTo.'
  };
 });
}
