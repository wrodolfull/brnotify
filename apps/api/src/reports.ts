import {Router} from 'express';
import {DateTime} from 'luxon';
import {query,pageParams} from './db.js';
import {authenticate,tenant,wrap} from './auth.js';
import {ApiOperationError} from './external-operations.js';
import {exportCsv,fillTrend,reportFilterSchema,reportWindow} from './reports-utils.js';

export const reportRouter=Router();
reportRouter.use(authenticate,tenant());

type FilterArgs={tenantId:string;start:string;end:string;kind:string;status:string;search:string};
const activitySource=[
 // Disparos: o período representa a data em que estavam programados.
 [
  "select m.id::text as id,'message'::text as kind,m.status::text as status,",
  "e.title::text as title,c.name::text as subject,e.external_id::text as external_id,",
  "m.scheduled_at as occurred_at,",
  "case when m.error_description is not null then left(m.error_description,250)",
  "else 'WhatsApp · lembrete '||m.slot::text end::text as detail,",
  "m.error_code::text as error_code",
  "from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id",
  "join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id",
  "where m.tenant_id=$1 and m.scheduled_at>=$2 and m.scheduled_at<$3"
 ].join(' '),
 // Agendamentos por data prevista.
 [
  "select e.id::text,'appointment'::text,e.status::text,e.title::text,c.name::text,",
  "e.external_id::text,e.starts_at,",
  "case when e.confirmation_enabled then 'Confirmação: '||e.confirmation_status",
  "else 'Sem solicitação de confirmação' end::text,null::text",
  "from events e join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id",
  "where e.tenant_id=$1 and e.starts_at>=$2 and e.starts_at<$3"
 ].join(' '),
 // Confirmações pela data de resposta, não pela data do agendamento.
 [
  "select e.id::text,'confirmation'::text,e.confirmation_status::text,e.title::text,c.name::text,",
  "e.external_id::text,e.confirmation_received_at,",
  "'Resposta recebida via WhatsApp'::text,null::text",
  "from events e join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id",
  "where e.tenant_id=$1 and e.confirmation_received_at>=$2",
  "and e.confirmation_received_at<$3 and e.confirmation_status in('confirmed','reschedule_requested','declined')"
 ].join(' '),
 // Integrações externas.
 [
  "select d.id::text,'webhook'::text,d.status::text,d.event_type::text,ep.label::text,",
  "null::text,d.created_at,left(coalesce(d.last_error,'Tentativas: '||d.attempts::text),250)::text,",
  "d.last_status_code::text",
  "from outbound_webhook_deliveries d",
  "join outbound_webhook_endpoints ep on ep.id=d.endpoint_id and ep.tenant_id=d.tenant_id",
  "where d.tenant_id=$1 and d.created_at>=$2 and d.created_at<$3"
 ].join(' '),
 [
  "select l.id::text,'api'::text,",
  "case when l.status_code>=400 then 'failed' else 'success' end::text,",
  "(l.method||' '||l.route)::text,coalesce(k.label,'Chave revogada')::text,",
  "null::text,l.created_at,",
  "(l.duration_ms::text||' ms · HTTP '||l.status_code::text)::text,l.status_code::text",
  "from integration_api_logs l left join integration_api_keys k",
  "on k.id=l.api_key_id and k.tenant_id=l.tenant_id",
  "where l.tenant_id=$1 and l.created_at>=$2 and l.created_at<$3"
 ].join(' '),
 [
  "select i.id::text,'import'::text,",
  "case when i.rejected>0 then 'partial' else 'completed' end::text,",
  "i.file_name::text,'Importação de dados'::text,null::text,i.created_at,",
  "(i.imported::text||' importados · '||i.rejected::text||' rejeitados')::text,null::text",
  "from import_jobs i where i.tenant_id=$1 and i.created_at>=$2 and i.created_at<$3"
 ].join(' ')
];
const ACTIVITY_CTE='with activity as ('+activitySource.join(' union all ')+') ';
const FILTER_CLAUSE=[
 "where ($4::text='all' or a.kind=$4)",
 "and ($5::text='all' or a.status=$5)",
 "and ($6::text='' or a.title ilike $7 or a.subject ilike $7",
 "or coalesce(a.external_id,'') ilike $7)"
].join(' ');
function params(f:FilterArgs){
 const escaped=f.search.replace(/[\\%_]/g,'\\$&');
 return [f.tenantId,f.start,f.end,f.kind,f.status,f.search,'%'+escaped+'%'];
}
async function context(req:import('express').Request){
 const tenantId=req.tenantId!;
 const t=await query('select timezone,name from tenants where id=$1',[tenantId]);
 if(!t.rowCount)throw new ApiOperationError(404,'Ambiente não encontrado');
 const parsed=reportFilterSchema.parse(req.query);
 if(parsed.days&&(parsed.from||parsed.to))
  throw new ApiOperationError(422,'Utilize days ou from/to, não ambos');
 const timezone=t.rows[0].timezone as string;
 const localNow=DateTime.now().setZone(timezone);
 const filterRange=parsed.days?{
  from:localNow.minus({days:parsed.days-1}).toISODate()!,
  to:localNow.toISODate()!
 }:parsed;
 let period;
 try{period=reportWindow(filterRange,timezone)}
 catch(err){throw new ApiOperationError(422,err instanceof Error?err.message:'Período inválido')}
 return {tenantId,filter:parsed,period,tenantName:t.rows[0].name as string};
}
async function loadActivities(f:FilterArgs,limit:number,offset:number){
 const bind=params(f);
 return query(
  ACTIVITY_CTE+'select a.* from activity a '+FILTER_CLAUSE+
  ' order by a.occurred_at desc,a.kind,a.id desc limit $8 offset $9',
  [...bind,limit,offset]
 );
}
async function countActivities(f:FilterArgs){
 const result=await query(
  ACTIVITY_CTE+'select count(*)::int total from activity a '+FILTER_CLAUSE,
  params(f)
 );
 return result.rows[0].total as number;
}
async function reportSummary(tenantId:string,start:string,end:string,zone:string,bucket:'day'|'week'|'month'){
 const common=[tenantId,start,end];
 const [messages,appointments,confirmations,contacts,imports,webhooks,api,errors,trend]=await Promise.all([
  query([
   "select count(*)::int total,",
   "count(*) filter(where status='scheduled')::int scheduled,",
   "count(*) filter(where status='processing')::int processing,",
   "count(*) filter(where status='sent')::int sent,",
   "count(*) filter(where status='delivered')::int delivered,",
   "count(*) filter(where status='failed')::int failed,",
   "count(*) filter(where status='unknown')::int unknown,",
   "count(*) filter(where status='cancelled')::int cancelled,",
   "count(*) filter(where sent_at is not null)::int accepted,",
   "coalesce(sum(attempt_count),0)::int attempts",
   "from scheduled_messages where tenant_id=$1 and scheduled_at>=$2 and scheduled_at<$3"
  ].join(' '),common),
  query([
   "select count(*)::int total,",
   "count(*) filter(where status='scheduled')::int scheduled,",
   "count(*) filter(where status='cancelled')::int cancelled,",
   "count(*) filter(where status='completed')::int completed,",
   "count(*) filter(where confirmation_enabled)::int confirmation_enabled,",
   "count(*) filter(where confirmation_status='pending')::int pending",
   "from events where tenant_id=$1 and starts_at>=$2 and starts_at<$3"
  ].join(' '),common),
  query([
   "select count(*)::int total,",
   "count(*) filter(where confirmation_status='confirmed')::int confirmed,",
   "count(*) filter(where confirmation_status='reschedule_requested')::int reschedule_requested,",
   "count(*) filter(where confirmation_status='declined')::int declined",
   "from events where tenant_id=$1 and confirmation_received_at>=$2 and confirmation_received_at<$3"
  ].join(' '),common),
  query("select count(*)::int created from contacts where tenant_id=$1 and created_at>=$2 and created_at<$3",common),
  query([
   "select count(*)::int jobs,",
   "coalesce(sum(imported),0)::int imported,coalesce(sum(rejected),0)::int rejected",
   "from import_jobs where tenant_id=$1 and created_at>=$2 and created_at<$3"
  ].join(' '),common),
  query([
   "select count(*)::int total,",
   "count(*) filter(where status='delivered')::int delivered,",
   "count(*) filter(where status='dead')::int failed,",
   "count(*) filter(where status in('queued','processing'))::int pending",
   "from outbound_webhook_deliveries where tenant_id=$1 and created_at>=$2 and created_at<$3"
  ].join(' '),common),
  query([
   "select count(*)::int total,count(*) filter(where status_code>=400)::int failed,",
   "coalesce(round(avg(duration_ms)),0)::int average_ms",
   "from integration_api_logs where tenant_id=$1 and created_at>=$2 and created_at<$3"
  ].join(' '),common),
  query([
   "select coalesce(nullif(error_code,''),'SEM_CODIGO') as code,",
   "max(left(error_description,150)) as description,count(*)::int count",
   "from scheduled_messages where tenant_id=$1 and scheduled_at>=$2 and scheduled_at<$3",
   "and status='failed' group by 1 order by count desc limit 5"
  ].join(' '),common),
  query([
   "select to_char(date_trunc($4::text,scheduled_at at time zone $5),'YYYY-MM-DD') period,",
   "count(*) filter(where sent_at is not null)::int sent,",
   "count(*) filter(where status='delivered')::int delivered,",
   "count(*) filter(where status='failed')::int failed",
   "from scheduled_messages where tenant_id=$1 and scheduled_at>=$2 and scheduled_at<$3",
   "group by 1 order by 1"
  ].join(' '),[...common,bucket,zone])
 ]);
 return {
  messages:messages.rows[0],appointments:appointments.rows[0],
  confirmations:confirmations.rows[0],contacts:contacts.rows[0],
  imports:imports.rows[0],webhooks:webhooks.rows[0],api:api.rows[0],
  top_errors:errors.rows,
  trend:trend.rows.map((row:any)=>({
   period:row.period,sent:Number(row.sent),delivered:Number(row.delivered),failed:Number(row.failed)
  }))
 };
}
reportRouter.get('/',wrap(async(req,res)=>{
 const ctx=await context(req);
 const {tenantId,period,tenantName}=ctx;
 const counts=await reportSummary(tenantId,period.startISO,period.endISO,period.zone,period.bucket);
 const messages=counts.messages;
 const denominator=Number(messages.accepted||0);
 const deliveryRate=denominator?Math.round((Number(messages.delivered||0)/denominator)*1000)/10:null;
 res.json({
  tenant:tenantName,period:{from:period.from,to:period.to,bucket:period.bucket},
  ...counts,delivery_rate:deliveryRate,
  trend:fillTrend(counts.trend,period)
 });
}));
reportRouter.get('/activity',wrap(async(req,res)=>{
 const ctx=await context(req),{filter,period,tenantId}=ctx;
 const base={tenantId,start:period.startISO,end:period.endISO,kind:filter.kind,status:filter.status,search:filter.q};
 const p=pageParams(filter.page);
 const [items,total]=await Promise.all([loadActivities(base,20,p.offset),countActivities(base)]);
 res.json({items:items.rows,total,page:p.page,pages:Math.ceil(total/20),limit:20});
}));
reportRouter.get('/export',wrap(async(req,res)=>{
 const ctx=await context(req),{filter,period,tenantId}=ctx;
 const base={tenantId,start:period.startISO,end:period.endISO,kind:filter.kind,status:filter.status,search:filter.q};
 // Evita consultas e respostas enormes. Exportação é uma operação separada da listagem.
 const max=2000;
 const list=await loadActivities(base,max+1,0);
 const truncated=list.rows.length>max;
 const items=list.rows.slice(0,max);
 const lines:unknown[][]=[
  ['BR Notify — Relatório único',ctx.tenantName],
  ['Período local',period.from+' a '+period.to],
  ['Filtro de origem',filter.kind],['Filtro de status',filter.status],
  ['Busca',filter.q||'Todas'],['Observação','Datas de acordo com o tipo de atividade'],
  [],
  ['Data/hora (UTC)','Origem','Status','Título','Contato ou integração','ID externo','Detalhe','Código de erro']
 ];
 for(const item of items)lines.push([
  new Date(item.occurred_at).toISOString(),
  item.kind,item.status,item.title,item.subject,item.external_id,item.detail,item.error_code
 ]);
 const file=exportCsv(lines);
 res.setHeader('Content-Type','text/csv; charset=utf-8');
 res.setHeader('Content-Disposition','attachment; filename="brnotify-relatorio-'+period.from+'-a-'+period.to+'.csv"');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Report-Truncated',truncated?'true':'false');
 res.status(200).send(file);
}));
