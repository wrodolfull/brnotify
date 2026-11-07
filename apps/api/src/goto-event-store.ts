import {pool,query,pageParams} from './db.js';
import type {NormalizedGotoEvent} from './goto-event-normalizer.js';

export async function recordGotoEvent(tenantId:string,event:NormalizedGotoEvent,accountKey:string){
 if(event.accountKey&&event.accountKey!==accountKey)
  throw new Error('A notificação pertence a outra conta GoTo.');
 const db=await pool.connect();
 try{
  await db.query('begin');
  const saved=await db.query(
   "insert into integration_events(tenant_id,source,external_key,event_type,conversation_space_id,occurred_at,metadata) values($1,$2,$3,$4,$5,$6,$7) on conflict(tenant_id,provider,source,external_key) do nothing returning id",
   [tenantId,event.source,event.externalKey,event.type,event.conversationId,event.occurredAt,JSON.stringify(event.metadata)]
  );
  if(!saved.rowCount){await db.query('commit');return {inserted:false}}
  if(event.source==='call-events'&&event.conversationId){
   const started=event.stateType==='STARTING'?event.occurredAt:null;
   const ended=event.stateType==='ENDING'?event.occurredAt:null;
   await db.query(
    `insert into goto_call_conversations(tenant_id,conversation_space_id,direction,last_state,last_sequence,sequence_gap,started_at,ended_at)
     values($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict(tenant_id,conversation_space_id) do update set
     direction=coalesce(goto_call_conversations.direction,excluded.direction),
     sequence_gap=goto_call_conversations.sequence_gap or
      (excluded.last_sequence>goto_call_conversations.last_sequence+1),
     last_state=case when excluded.last_sequence>=goto_call_conversations.last_sequence then excluded.last_state else goto_call_conversations.last_state end,
     last_sequence=greatest(goto_call_conversations.last_sequence,excluded.last_sequence),
     started_at=coalesce(goto_call_conversations.started_at,excluded.started_at),
     ended_at=coalesce(goto_call_conversations.ended_at,excluded.ended_at),
     updated_at=now()`,
    [tenantId,event.conversationId,event.direction,event.stateType,event.sequence,
     event.sequence!>1,started,ended]
   );
  }
  if(event.source==='call-events-report'&&event.conversationId){
   await db.query(
    `insert into goto_call_conversations(tenant_id,conversation_space_id,report_status,report_due_at)
     values($1,$2,'pending',now())
     on conflict(tenant_id,conversation_space_id) do update set
     report_status=case when goto_call_conversations.report_status='complete' and $3::boolean=false then 'complete' else 'pending' end,
     report_due_at=case when goto_call_conversations.report_status='complete' and $3::boolean=false then goto_call_conversations.report_due_at else now() end,
     report_attempts=case when $3::boolean then 0 else goto_call_conversations.report_attempts end,
     report_last_error=null,updated_at=now()`,
    [tenantId,event.conversationId,event.metadata.report_type==='REPORT_SUMMARY_REVISION']
   );
  }
  await db.query('commit');
  return {inserted:true};
 }catch(e){await db.query('rollback');throw e}
 finally{db.release()}
}

export async function listGoToEvents(tenantId:string,page:unknown,kind:'call'|'message'|'all'){
 const p=pageParams(page);
 const filter=kind==='call'?"and event_type like 'call.%'":kind==='message'?"and event_type like 'message.%'":'';
 const [items,total]=await Promise.all([
  query(`select id,event_type,source,conversation_space_id,occurred_at,metadata
   from integration_events where tenant_id=$1 ${filter}
   order by occurred_at desc,id desc limit 20 offset $2`,[tenantId,p.offset]),
  query(`select count(*)::int as n from integration_events where tenant_id=$1 ${filter}`,[tenantId])
 ]);
 return {items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/20)};
}
export async function listGoToCalls(tenantId:string,page:unknown){
 const p=pageParams(page);
 const [items,total]=await Promise.all([
  query(`select conversation_space_id,direction,last_state,started_at,ended_at,
   sequence_gap,report_status,summary,updated_at
   from goto_call_conversations where tenant_id=$1 order by coalesce(ended_at,started_at,created_at) desc,id desc
   limit 20 offset $2`,[tenantId,p.offset]),
  query('select count(*)::int as n from goto_call_conversations where tenant_id=$1',[tenantId])
 ]);
 return {items:items.rows,total:total.rows[0].n,page:p.page,pages:Math.ceil(total.rows[0].n/20)};
}
