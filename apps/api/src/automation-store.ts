import {query,pageParams} from './db.js';
import {flowSchema,type FlowInput} from './automation-model.js';
import {ApiOperationError,withTransaction} from './external-operations.js';

const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fromRow=(flow:any)=>flowSchema.parse({
 title:flow.title,trigger_type:flow.trigger_type,match_mode:flow.match_mode,
 match_text:flow.match_text,delay_minutes:flow.delay_minutes,
 check_no_new_message:flow.check_no_new_message,action_type:flow.action_type,
 action_label:flow.action_label,endpoint_id:flow.endpoint_id,
 template_id:flow.template_id,template_variables:flow.template_variables
});
const stored=(input:FlowInput)=>[
 input.title,input.trigger_type,input.match_mode,input.match_text||null,input.delay_minutes,
 input.check_no_new_message,input.action_type,input.action_label,input.endpoint_id||null,
 input.template_id||null,JSON.stringify(input.template_variables)
];

export async function ensureFlowDependencies(tenantId:string,input:FlowInput){
 if(input.action_type==='webhook'){
  const ep=await query('select active from outbound_webhook_endpoints where tenant_id=$1 and id=$2',[tenantId,input.endpoint_id]);
  if(!ep.rows[0]?.active)throw new ApiOperationError(422,'O webhook precisa existir e estar ativo neste ambiente.');
 }
 if(input.action_type==='whatsapp'){
  const [tpl,connection]=await Promise.all([
   query("select id from message_templates where tenant_id=$1 and id=$2 and status='APPROVED'",[tenantId,input.template_id]),
   query('select 1 from goto_connections where tenant_id=$1 and account_key is not null and from_touchpoint is not null',[tenantId])
  ]);
  if(!tpl.rowCount)throw new ApiOperationError(422,'Escolha um template WhatsApp aprovado.');
  if(!connection.rowCount)throw new ApiOperationError(422,'Conecte o WhatsApp da GoTo antes de ativar.');
 }
}
export async function createFlow(tenantId:string,raw:unknown){
 const data=flowSchema.parse(raw);
 await ensureFlowDependencies(tenantId,data);
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1))',['automations:'+tenantId]);
  const count=await run('select count(*)::int total from automation_flows where tenant_id=$1',[tenantId]);
  if(Number(count.rows[0].total)>=40)throw new ApiOperationError(409,'Limite de 40 automações por ambiente.');
  const saved=await run(
   `insert into automation_flows(tenant_id,title,trigger_type,match_mode,match_text,delay_minutes,
    check_no_new_message,action_type,action_label,endpoint_id,template_id,template_variables)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
   [tenantId,...stored(data)]
  );
  return saved.rows[0];
 });
}
export async function updateFlow(tenantId:string,id:string,raw:unknown){
 if(!uuidRe.test(id))throw new ApiOperationError(422,'Identificador inválido');
 const data=flowSchema.parse(raw);
 await ensureFlowDependencies(tenantId,data);
 return withTransaction(async run=>{
  const exists=await run('select status from automation_flows where tenant_id=$1 and id=$2 for update',[tenantId,id]);
  if(!exists.rowCount)throw new ApiOperationError(404,'Automação não encontrada.');
  if(exists.rows[0].status==='active')throw new ApiOperationError(409,'Pause a automação antes de editar.');
  const updated=await run(
   `update automation_flows set title=$3,trigger_type=$4,match_mode=$5,match_text=$6,
    delay_minutes=$7,check_no_new_message=$8,action_type=$9,action_label=$10,
    endpoint_id=$11,template_id=$12,template_variables=$13,revision=revision+1,updated_at=now()
    where tenant_id=$1 and id=$2 returning *`,
   [tenantId,id,...stored(data)]
  );
  await run("update automation_runs set status='cancelled',reason='Automação editada',finished_at=now() where tenant_id=$1 and flow_id=$2 and status='pending'",[tenantId,id]);
  return updated.rows[0];
 });
}
export async function setFlowStatus(tenantId:string,id:string,status:'active'|'paused'){
 if(!uuidRe.test(id))throw new ApiOperationError(422,'Identificador inválido');
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1))',['automations:'+tenantId]);
  const found=await run('select * from automation_flows where tenant_id=$1 and id=$2 for update',[tenantId,id]);
  if(!found.rowCount)throw new ApiOperationError(404,'Automação não encontrada.');
  const flow=found.rows[0];
  if(flow.status===status)return flow;
  if(status==='active'){
   const active=await run("select count(*)::int total from automation_flows where tenant_id=$1 and status='active'",[tenantId]);
   if(Number(active.rows[0].total)>=20)throw new ApiOperationError(409,'Limite de 20 automações ativas.');
   // Dependencies validated using the same tenant, but resource state may change before transaction.
   await ensureFlowDependencies(tenantId,fromRow(flow));
   if(['call.ai.insight.detected','call.voicemail.new','call.voicemail.read',
    'call.voicemail.deleted','call.receptionist.scheduling_issue'].includes(flow.trigger_type)){
    const monitoring=await run(
     'select enabled,report_revision_subscription_id from goto_call_monitors where tenant_id=$1',
     [tenantId]
    );
    if(!monitoring.rows[0]?.enabled||!monitoring.rows[0]?.report_revision_subscription_id)
     throw new ApiOperationError(409,'Ative a inteligência de chamadas na conexão GoTo antes de ativar esta automação.');
   }
  }
  await run("update automation_runs set status='cancelled',reason='Automação pausada ou reativada',finished_at=now() where tenant_id=$1 and flow_id=$2 and status='pending'",[tenantId,id]);
  const changed=await run(
   `update automation_flows set status=$3,revision=revision+1,
    cursor_received_at=now(),cursor_event_id='00000000-0000-0000-0000-000000000000'::uuid,
    last_error=null,updated_at=now() where tenant_id=$1 and id=$2 returning *`,[tenantId,id,status]
  );
  return changed.rows[0];
 });
}
/** Permanently remove an automation and its execution history.
 * Pending side-effects are cancelled first, never silently allowed to send.
 * Processing side-effects cannot safely be recalled, so refuse the delete.
 */
export async function deleteFlow(tenantId:string,id:string){
 if(!uuidRe.test(id))throw new ApiOperationError(422,'Identificador inválido');
 return withTransaction(async run=>{
  await run('select pg_advisory_xact_lock(hashtext($1))',['automations:'+tenantId]);
  const found=await run(
   'select id,title from automation_flows where tenant_id=$1 and id=$2 for update',
   [tenantId,id]
  );
  if(!found.rowCount)throw new ApiOperationError(404,'Automação não encontrada.');
  const runs=await run(
   'select id,status from automation_runs where tenant_id=$1 and flow_id=$2 for update',
   [tenantId,id]
  );
  if(runs.rows.some(row=>row.status==='processing'))
   throw new ApiOperationError(409,'Esta automação tem uma execução em andamento. Tente excluir depois que ela terminar.');
  const sending=await run(
   `select id,status from on_demand_messages where tenant_id=$1
    and automation_run_id in(select id from automation_runs where tenant_id=$1 and flow_id=$2)
    and status in ('queued','processing') for update`,[tenantId,id]
  );
  if(sending.rows.some(row=>row.status==='processing'))
   throw new ApiOperationError(409,'Existe um envio WhatsApp em processamento. Aguarde antes de excluir a automação.');
  const deliveries=await run(
   `select id,status from outbound_webhook_deliveries where tenant_id=$1
    and event_type='automation.triggered'
    and event_id in(select id from automation_runs where tenant_id=$1 and flow_id=$2)
    and status in ('queued','processing') for update`,[tenantId,id]
  );
  if(deliveries.rows.some(row=>row.status==='processing'))
   throw new ApiOperationError(409,'Existe uma entrega webhook em processamento. Aguarde antes de excluir.');
  const msgs=await run(
   `update on_demand_messages set status='cancelled',error_code='FLOW_DELETED',
    error_description='Automação excluída antes do envio',updated_at=now()
    where tenant_id=$1 and status='queued'
     and automation_run_id in(select id from automation_runs where tenant_id=$1 and flow_id=$2)
    returning id`,[tenantId,id]
  );
  const out=await run(
   `update outbound_webhook_deliveries set status='dead',
    last_error='Automação excluída antes da entrega'
    where tenant_id=$1 and event_type='automation.triggered' and status='queued'
    and event_id in(select id from automation_runs where tenant_id=$1 and flow_id=$2)
    returning id`,[tenantId,id]
  );
  // on delete cascade removes automation_runs; delivered/accepted messages
  // remain in the provider histories and must not be retracted or re-sent.
  await run('delete from automation_flows where tenant_id=$1 and id=$2',[tenantId,id]);
  return {deleted:true,removed_runs:runs.rowCount||0,
   cancelled_messages:msgs.rowCount||0,cancelled_webhooks:out.rowCount||0};
 });
}

export async function listFlows(tenantId:string,page:unknown){
 const p=pageParams(page);
 const [rows,n]=await Promise.all([
  query(`select f.*, (select count(*)::int from automation_runs r
    where r.flow_id=f.id and r.tenant_id=f.tenant_id and r.created_at>now()-interval '7 days') as recent_runs
    from automation_flows f where f.tenant_id=$1 order by f.created_at desc limit 50 offset $2`,[tenantId,p.offset]),
  query('select count(*)::int total from automation_flows where tenant_id=$1',[tenantId])
 ]);
 return {items:rows.rows,total:n.rows[0].total,page:p.page,pages:Math.ceil(n.rows[0].total/50)};
}
export async function listRuns(tenantId:string,page:unknown,flowId:string|null){
 if(flowId&&!uuidRe.test(flowId))throw new ApiOperationError(422,'Identificador inválido');
 const p=pageParams(page);
 const [rows,n]=await Promise.all([
  query(`select r.id,r.flow_id,f.title as flow_title,r.status,r.due_at,r.reason,r.result,
    r.created_at,r.finished_at,e.event_type,e.occurred_at,
    e.metadata->>'phone' as phone,
    e.metadata->>'signal_code' as signal_code
    from automation_runs r join automation_flows f on f.id=r.flow_id and f.tenant_id=r.tenant_id
    join integration_events e on e.id=r.event_id and e.tenant_id=r.tenant_id
    where r.tenant_id=$1 and ($2::uuid is null or r.flow_id=$2)
    order by r.created_at desc,r.id desc limit 50 offset $3`,[tenantId,flowId,p.offset]),
  query('select count(*)::int total from automation_runs where tenant_id=$1 and ($2::uuid is null or flow_id=$2)',[tenantId,flowId])
 ]);
 return {items:rows.rows,total:n.rows[0].total,page:p.page,pages:Math.ceil(n.rows[0].total/50)};
}
