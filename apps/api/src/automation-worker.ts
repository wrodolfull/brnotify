import {pool,query} from './db.js';
import {matchesFlow,interpolateVariables,type EventForFlow} from './automation-model.js';
import {enqueuePanelNotification} from './panel-notifications.js';
import {phoneE164} from './time.js';

const ZERO='00000000-0000-0000-0000-000000000000';
/** Dispatch scanning is transactional: cursor and queued runs commit together. */
export async function scanAutomationEvents(){
 const client=await pool.connect();
 let created=0;
 try{
  await client.query('begin');
  const selected=await client.query(
   `select f.* from automation_flows f join tenants t on t.id=f.tenant_id
    where f.status='active' and t.status='active'
    order by f.updated_at,f.id for update of f skip locked limit 20`
  );
  for(const flow of selected.rows){
   const events=await client.query(
    `select id,event_type,occurred_at,received_at,metadata,conversation_space_id
     from integration_events where tenant_id=$1 and
      (received_at,id) > ($2::timestamptz,$3::uuid)
     order by received_at,id limit 100`,
    [flow.tenant_id,flow.cursor_received_at,flow.cursor_event_id||ZERO]
   );
   if(!events.rowCount)continue;
   const volume=await client.query(
    "select count(*)::int total from automation_runs where tenant_id=$1 and created_at>=now()-interval '1 day'",
    [flow.tenant_id]
   );
   let quota=Number(volume.rows[0].total);
   let overLimit=false;
   for(const event of events.rows){
    if(!matchesFlow(flow,event as EventForFlow))continue;
    if(event.event_type==='message.delivery.updated'){
     // Some GoTo delivery payloads omit their channel. Only track messages sent by BR Notify.
     const providerId=typeof event.metadata?.messageId==='string'?event.metadata.messageId:'';
     if(!providerId)continue;
     const verified=await client.query(
      `select 1 from on_demand_messages where tenant_id=$1 and provider_message_id=$2
       union all select 1 from scheduled_messages where tenant_id=$1 and goto_message_id=$2
       limit 1`,[flow.tenant_id,providerId]
     );
     if(!verified.rowCount)continue;
    }
    if(quota>=1500){overLimit=true;break}
    const due=new Date(Date.now()+flow.delay_minutes*60_000);
    const inserted=await client.query(
     `insert into automation_runs(tenant_id,flow_id,event_id,revision,due_at)
      values($1,$2,$3,$4,$5) on conflict(flow_id,event_id) do nothing returning id`,
     [flow.tenant_id,flow.id,event.id,flow.revision,due]
    );
    if(inserted.rowCount){created++;quota++}
   }
   if(overLimit){
    await client.query(
     "update automation_runs set status='cancelled',reason='Limite de segurança atingido',finished_at=now() where tenant_id=$1 and flow_id=$2 and status='pending'",
     [flow.tenant_id,flow.id]
    );
    await client.query(
     `update automation_flows set status='paused',
      last_error='Limite de 1.500 execuções em 24 horas neste ambiente. Revise os gatilhos antes de reativar.',
      updated_at=now() where id=$1`,[flow.id]
    );
    continue;
   }
   const last=events.rows[events.rows.length-1];
   await client.query(
    'update automation_flows set cursor_received_at=$2,cursor_event_id=$3 where id=$1',
    [flow.id,last.received_at,last.id]
   );
  }
  await client.query('commit');
 }catch(e){await client.query('rollback');throw e}
 finally{client.release()}
 return created;
}

function subjectPhone(event:EventForFlow){
 if(event.event_type!=='message.received'||event.metadata?.channel!=='WHATSAPP')return null;
 try{return phoneE164(event.metadata.phone)}catch{return null}
}

export async function processAutomationRun(){
 const claimed=await query(
  `with due as (
    select r.id from automation_runs r join automation_flows f on f.id=r.flow_id and f.tenant_id=r.tenant_id
    join tenants t on t.id=r.tenant_id
    where r.status='pending' and r.due_at<=now() and f.status='active' and t.status='active'
    order by r.due_at,r.id for update of r skip locked limit 1
   )
   update automation_runs r set status='processing',started_at=now()
   from due where r.id=due.id returning r.id`
 );
 if(!claimed.rowCount)return 0;
 const id=claimed.rows[0].id as string;
 let actionStarted=false;
 try{
  const details=await query(
   `select r.tenant_id,r.flow_id,r.revision,f.status as flow_status,f.revision as flow_revision,
    f.trigger_type,f.match_mode,f.match_text,f.check_no_new_message,
    f.action_type,f.action_label,f.endpoint_id,f.template_id,f.template_variables,
    e.id as event_id,e.event_type,e.occurred_at,e.metadata,e.conversation_space_id,
    t.status as tenant_status
    from automation_runs r join automation_flows f on f.id=r.flow_id and f.tenant_id=r.tenant_id
    join integration_events e on e.id=r.event_id and e.tenant_id=r.tenant_id
    join tenants t on t.id=r.tenant_id where r.id=$1`,[id]
  );
  const row=details.rows[0];
  if(!row)throw new Error('Dados de execução indisponíveis');
  if(row.flow_status!=='active'||row.revision!==row.flow_revision||row.tenant_status!=='active'){
   await finish(id,'cancelled','A automação foi pausada ou alterada.');
   return 1;
  }
  const phone=subjectPhone(row);
  if(row.check_no_new_message){
   if(!phone){await finish(id,'skipped','Não foi possível validar o número de origem.');return 1}
   const later=await query(
    `select 1 from integration_events where tenant_id=$1 and event_type='message.received'
     and metadata->>'channel'='WHATSAPP' and metadata->>'phone'=$2
     and occurred_at>$3 and id<>$4 limit 1`,
    [row.tenant_id,phone,row.occurred_at,row.event_id]
   );
   if(later.rowCount){await finish(id,'skipped','O cliente respondeu novamente antes do prazo.');return 1}
  }
  if(row.action_type==='internal'){
   await finish(id,'completed',null,{kind:'internal',label:row.action_label});
   return 1;
  }
  if(row.action_type==='webhook'){
   // Existing signed HTTPS outbox handles secure delivery, retries and idempotency.
   const client=await pool.connect();
   try{
    await client.query('begin');
    const active=await client.query(
     'select id from outbound_webhook_endpoints where tenant_id=$1 and id=$2 and active=true',
     [row.tenant_id,row.endpoint_id]
    );
    if(!active.rowCount)throw new Error('Webhook desativado ou não encontrado.');
    const event={id,type:'automation.triggered',timestamp:new Date().toISOString(),data:{
     flow_id:row.flow_id,trigger_type:row.event_type,
     occurred_at:row.occurred_at,conversation_id:row.conversation_space_id,
     phone:row.event_type==='message.received'?phone:null,
     message_text:row.event_type==='message.received'?String(row.metadata.text||'').slice(0,500):null,
     signal_code:row.event_type.startsWith('call.')&&typeof row.metadata?.signal_code==='string'
      ?row.metadata.signal_code.slice(0,100):null,
     signal_group:row.event_type.startsWith('call.')&&typeof row.metadata?.signal_group==='string'
      ?row.metadata.signal_group.slice(0,40):null
    }};
    const queued=await client.query(
     `insert into outbound_webhook_deliveries(tenant_id,endpoint_id,event_id,event_type,payload)
      values($1,$2,$3,'automation.triggered',$4)
      on conflict(endpoint_id,event_id) do update set id=outbound_webhook_deliveries.id returning id`,
     [row.tenant_id,row.endpoint_id,id,JSON.stringify(event)]
    );
    await client.query(
     "update automation_runs set status='completed',result=$2,finished_at=now() where id=$1 and status='processing'",
     [id,JSON.stringify({kind:'webhook',delivery_id:queued.rows[0].id,delivery:'queued'})]
    );
    await client.query('commit');
   }catch(e){await client.query('rollback');throw e}
   finally{client.release()}
   return 1;
  }
  if(row.action_type==='whatsapp'){
   if(!phone){await finish(id,'skipped','O WhatsApp exige uma resposta recebida com número válido.');return 1}
   const contact=await query(
    'select id,name,phone from contacts where tenant_id=$1 and phone=$2 and consent=true and opted_out_at is null and consent_source is not null',
    [row.tenant_id,phone]
   );
   if(!contact.rowCount){await finish(id,'skipped','Contato sem autorização registrada para mensagens.');return 1}
   const tpl=await query(
    "select 1 from message_templates where tenant_id=$1 and id=$2 and status='APPROVED'",
    [row.tenant_id,row.template_id]
   );
   if(!tpl.rowCount){await finish(id,'failed','Template GoTo indisponível ou não aprovado.');return 1}
   const vars=interpolateVariables(row.template_variables||{},contact.rows[0],String(row.metadata?.text||''));
   // We never automatically retry a run after an ambiguous side-effect.
   actionStarted=true;
   const result=await enqueuePanelNotification(row.tenant_id,{
    contact_id:contact.rows[0].id,template_id:row.template_id,variables:vars
   },{source:'automation',runId:id});
   await finish(id,'completed',null,{kind:'whatsapp',message_id:result.id,status:'queued'});
   return 1;
  }
  throw new Error('Ação desconhecida');
 }catch(e){
  const reason=e instanceof Error?e.message:'Erro ao executar ação';
  await finish(id,actionStarted?'unknown':'failed',reason.slice(0,250));
  return 1;
 }
}
async function finish(id:string,status:'completed'|'skipped'|'failed'|'cancelled'|'unknown',reason:string|null=null,result:object={}){
 await query(
  `update automation_runs set status=$2,reason=$3,result=$4,finished_at=now()
   where id=$1 and status='processing'`,[id,status,reason,JSON.stringify(result)]
 );
}
export async function reclaimAutomationRuns(){
 // A crashed process may already have queued an external side effect; never blindly re-send.
 await query(
  `update automation_runs set status='unknown',
   reason='Worker interrompido durante a ação. Verifique o histórico antes de tentar novamente.',
   finished_at=now()
   where status='processing' and started_at<now()-interval '3 minutes'`
 );
}
export async function cleanupAutomationRuns(){
 await query("delete from automation_runs where created_at<now()-interval '90 days'");
}
