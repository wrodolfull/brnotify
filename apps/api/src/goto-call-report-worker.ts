import {query,pool} from './db.js';
import {gotoRequest} from './goto.js';
import {recordGotoEvent} from './goto-event-store.js';

type Report={
 accountKey?:string;conversationSpaceId?:string;
 direction?:string;callCreated?:string;callEnded?:string;
 participants?:unknown[];callStates?:unknown[]
};
function dateOrNull(value:unknown){
 if(typeof value!=='string')return null;
 const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString():null;
}
function extractPhone(report:Report){
 const numbers=new Set<string>();
 for(const p of report.participants||[]){
  if(!p||typeof p!=='object')continue;
  const type=(p as any).type;
  if(type?.value!=='PHONE_NUMBER')continue;
  const number=type?.caller?.number||type?.callee?.number||type?.number;
  if(typeof number==='string'&&/^\+?[0-9]{7,18}$/.test(number))numbers.add(number);
 }
 return numbers.size===1?[...numbers][0]:null;
}
export function summarizeCallReport(report:Report){
 return {
  external_number:extractPhone(report),
  participant_count:Array.isArray(report.participants)?report.participants.length:null,
  call_created:dateOrNull(report.callCreated),
  call_ended:dateOrNull(report.callEnded),
  // Intentionally no answered/missed flag: multi-leg calls require separate analysis.
  classification:'not_classified'
 };
}

export async function processCallReportQueue(){
 const client=await pool.connect();
 let item:{id:string;tenant_id:string;conversation_space_id:string;report_attempts:number}|null=null;
 try{
  await client.query('begin');
  const found=await client.query(
   `select id,tenant_id,conversation_space_id from goto_call_conversations
    where report_status in ('pending','retry') and report_due_at<=now()
    order by report_due_at,id for update skip locked limit 1`
  );
  if(found.rowCount){
   const updated=await client.query(
    "update goto_call_conversations set report_status='processing',report_attempts=report_attempts+1,report_locked_at=now(),updated_at=now() where id=$1 returning id,tenant_id,conversation_space_id,report_attempts",
    [found.rows[0].id]
   );
   item=updated.rows[0];
  }
  await client.query('commit');
 }catch(e){await client.query('rollback');throw e}
 finally{client.release()}
 if(!item)return 0;
 try{
  const conn=await query('select account_key from goto_connections where tenant_id=$1',[item.tenant_id]);
  if(!conn.rows[0]?.account_key)throw Error('Conta GoTo indisponível para consultar o relatório.');
  const report=await gotoRequest(item.tenant_id,
   '/call-events-report/v1/reports/'+encodeURIComponent(item.conversation_space_id)) as Report;
  if(report.conversationSpaceId!==item.conversation_space_id||
   report.accountKey!==conn.rows[0].account_key)
   throw Error('O relatório retornado não corresponde à conversa e à conta conectada.');
  const summary=summarizeCallReport(report);
  await query(
   `update goto_call_conversations
    set report_status='complete',report_due_at=null,report_locked_at=null,report_last_error=null,
    direction=coalesce($2,direction),started_at=coalesce($3::timestamptz,started_at),
    ended_at=coalesce($4::timestamptz,ended_at),summary=$5,updated_at=now()
    where id=$1 and report_status='processing'`,
   [item.id,report.direction||null,summary.call_created,summary.call_ended,JSON.stringify(summary)]
  );
  await recordGotoEvent(item.tenant_id,{
   source:'call-events-report',externalKey:item.conversation_space_id+':report-ready',
   type:'call.report.ready',conversationId:item.conversation_space_id,
   occurredAt:summary.call_ended||new Date().toISOString(),direction:report.direction||null,
   stateType:null,sequence:null,accountKey:report.accountKey||null,
   metadata:{participant_count:summary.participant_count,classification:'not_classified'}
  },conn.rows[0].account_key);
 }catch(e){
  const detail=e instanceof Error?e.message:'Falha ao obter o relatório';
  const transient=/GoTo HTTP (429|404|408|5\d\d)|timeout|fetch failed|conexão/i.test(detail);
  const retry=transient&&item.report_attempts<8;
  const minutes=Math.min(60,Math.pow(2,Math.min(item.report_attempts,6)));
  await query(
   `update goto_call_conversations set report_status=$2,report_due_at=case when $2='retry'
    then now()+($3::int*interval '1 minute') else null end,
    report_locked_at=null,report_last_error=$4,updated_at=now()
    where id=$1 and report_status='processing'`,
   [item.id,retry?'retry':'failed',minutes,detail.slice(0,220)]
  );
 }
 return 1;
}

export async function reclaimCallReportQueue(){
 await query(
  `update goto_call_conversations set report_status='retry',
    report_due_at=now()+interval '1 minute',report_locked_at=null,
    report_last_error='Consulta interrompida, tentando novamente',updated_at=now()
   where report_status='processing' and report_locked_at<now()-interval '3 minutes'`
 );
}
