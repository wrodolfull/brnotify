import {useEffect,useMemo,useState} from 'react';
import {
 Activity,AlertTriangle,ArrowDownToLine,ArrowRight,BarChart3,CalendarDays,
 CheckCheck,ChevronDown,Clock3,FileSpreadsheet,Filter,Link2,RefreshCw,
 Search,Send,Users,Webhook
} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Loader,PageTitle,Pagination} from '../components';
import {fmtDate,fmtNum} from '../api';

type Kind='all'|'message'|'appointment'|'confirmation'|'webhook'|'api'|'import';
type ReportFilters={days:string;from:string;to:string;kind:Kind;status:string;q:string};
type Summary={
 tenant:string;period:{from:string;to:string;bucket:'day'|'week'|'month'};
 messages:{total:number;scheduled:number;processing:number;sent:number;delivered:number;failed:number;unknown:number;cancelled:number;accepted:number;attempts:number};
 appointments:{total:number;scheduled:number;cancelled:number;completed:number;confirmation_enabled:number;pending:number};
 confirmations:{total:number;confirmed:number;reschedule_requested:number;declined:number};
 contacts:{created:number};
 imports:{jobs:number;imported:number;rejected:number};
 webhooks:{total:number;delivered:number;failed:number;pending:number};
 api:{total:number;failed:number;average_ms:number};
 top_errors:{code:string;description:string|null;count:number}[];
 trend:{period:string;sent:number;delivered:number;failed:number}[];
 delivery_rate:number|null;
};
type ActivityItem={id:string;kind:Kind;status:string;title:string;subject:string;external_id:string|null;occurred_at:string;detail:string|null;error_code:string|null};
type Activities={items:ActivityItem[];total:number;page:number;pages:number};
const initial:ReportFilters={days:'30',from:'',to:'',kind:'all',status:'all',q:''};
const categories:{value:Kind;label:string}[]=[
 {value:'all',label:'Todas as origens'},
 {value:'message',label:'Disparos WhatsApp'},
 {value:'appointment',label:'Agendamentos'},
 {value:'confirmation',label:'Confirmações'},
 {value:'webhook',label:'Webhooks'},
 {value:'api',label:'Chamadas de API'},
 {value:'import',label:'Importações'}
];
const statuses=[
 ['all','Todos os status'],['scheduled','Programado'],['sent','Enviado'],['delivered','Entregue'],
 ['failed','Falhou'],['unknown','Indeterminado'],['cancelled','Cancelado'],
 ['confirmed','Confirmado'],['pending','Aguardando'],['reschedule_requested','Reagendamento'],
 ['declined','Recusado'],['queued','Na fila'],['dead','Falha definitiva'],
 ['success','Sucesso'],['partial','Parcial'],['completed','Concluído']
] as const;
const statusMap:Record<string,string>=Object.fromEntries(statuses.map(([key,value])=>[key,value]));
const kindMap:Record<string,string>=Object.fromEntries(categories.map(o=>[o.value,o.label]));
const statusStyle=(status:string)=>{
 if(['delivered','confirmed','success','completed'].includes(status))return 'report-status-ok';
 if(['failed','dead','unknown','declined'].includes(status))return 'report-status-bad';
 if(['queued','scheduled','pending','processing','sent'].includes(status))return 'report-status-pending';
 return 'report-status-muted';
};
const queryFilters=(f:ReportFilters,activity=false)=>{
 const p=new URLSearchParams();
 if(f.days==='custom'){
  if(f.from)p.set('from',f.from);
  if(f.to)p.set('to',f.to);
 }else p.set('days',f.days);
 if(activity){
  if(f.kind!=='all')p.set('kind',f.kind);
  if(f.status!=='all')p.set('status',f.status);
  if(f.q.trim())p.set('q',f.q.trim());
 }
 return p.toString();
};
function Metric({title,value,note,icon:Icon,highlight=false}:{
 title:string;value:string|number;note:string;icon:any;highlight?:boolean
}){
 return <div className={'report-metric '+(highlight?'report-metric-highlight':'')}>
  <div className="report-metric-top"><span>{title}</span><div className="report-metric-icon"><Icon size={18}/></div></div>
  <strong>{value}</strong><small>{note}</small>
 </div>;
}
function Trend({summary}:{summary:Summary}){
 const max=Math.max(1,...summary.trend.map(x=>x.sent+x.failed));
 const short=summary.trend.length>12;
 const hasData=summary.trend.some(x=>x.sent||x.delivered||x.failed);
 const label=(period:string)=>{
  const [year,month,day]=period.split('-');
  if(summary.period.bucket==='month')return month+'/'+year.slice(-2);
  return day+'/'+month;
 };
 return <Card className="report-chart">
  <div className="report-card-head"><div><span className="report-eyebrow">EVOLUÇÃO DO PERÍODO</span><h2>Desempenho dos disparos</h2><p>Por data prevista de envio · {summary.period.bucket==='day'?'Diário':summary.period.bucket==='week'?'Semanal':'Mensal'}</p></div><Activity size={20}/></div>
  <div className="report-legend"><span><i className="report-legend-sent"/>Aceitos pela GoTo</span><span><i className="report-legend-delivered"/>Entregues</span><span><i className="report-legend-failed"/>Falhas</span></div>
  <div className="report-chart-scroll">
   <div className={'report-chart-plot '+(short?'report-chart-wide':'')} role="img" aria-label="Gráfico de barras: mensagens aceitas, entregues e com falhas em cada intervalo do período.">
    <div className="report-gridline report-gridline-top"/>
    <div className="report-gridline report-gridline-middle"/>
    <div className="report-gridline report-gridline-bottom"/>
    {summary.trend.map((point,i)=><div className="report-chart-col" key={point.period} title={label(point.period)+': '+point.sent+' aceitos, '+point.delivered+' entregues, '+point.failed+' falhas'}>
      <div className="report-bars">
       <span className="report-bar report-bar-sent" style={{height:(point.sent/max*100)+'%'}}/>
       <span className="report-bar report-bar-delivered" style={{height:(point.delivered/max*100)+'%'}}/>
       <span className="report-bar report-bar-failed" style={{height:(point.failed/max*100)+'%'}}/>
      </div>
      <span className={'report-date-label '+(short&&i%Math.ceil(summary.trend.length/12)!==0?'report-date-hidden':'')}>{label(point.period)}</span>
     </div>)}
    {!hasData&&<div className="report-plot-empty">Os resultados aparecerão após os primeiros disparos.</div>}
   </div>
  </div>
 </Card>;
}
export function Reports(){
 const {api,tenantId,notify}=useApp();
 const [draft,setDraft]=useState<ReportFilters>(initial);
 const [applied,setApplied]=useState<ReportFilters>(initial);
 const [page,setPage]=useState(1);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [summaryError,setSummaryError]=useState('');
 const [summaryLoading,setSummaryLoading]=useState(true);
 const [activities,setActivities]=useState<Activities>({items:[],total:0,page:1,pages:1});
 const [activityError,setActivityError]=useState('');
 const [activityLoading,setActivityLoading]=useState(true);
 const [downloading,setDownloading]=useState(false);
 const [revision,setRevision]=useState(0);
 const rangeQuery=useMemo(()=>queryFilters(applied),[applied]);
 const activityQuery=useMemo(()=>queryFilters(applied,true),[applied]);
 const urlPath=(path:string,search:string)=>path+'?'+search;
 useEffect(()=>{
  let alive=true;setSummaryLoading(true);setSummaryError('');
  api(urlPath('/api/reports',rangeQuery)).then(result=>{if(alive)setSummary(result)})
   .catch(e=>{if(alive){setSummary(null);setSummaryError(e.message)}})
   .finally(()=>{if(alive)setSummaryLoading(false)});
  return()=>{alive=false};
 },[api,rangeQuery,revision,tenantId]);
 useEffect(()=>{
  let alive=true;setActivityLoading(true);setActivityError('');
  const params=new URLSearchParams(activityQuery);params.set('page',String(page));
  api('/api/reports/activity?'+params.toString()).then(result=>{if(alive)setActivities(result)})
   .catch(e=>{if(alive){setActivityError(e.message);setActivities({items:[],total:0,page,pages:1})}})
   .finally(()=>{if(alive)setActivityLoading(false)});
  return()=>{alive=false};
 },[api,activityQuery,page,revision,tenantId]);
 const apply=()=>{
  if(draft.days==='custom'&&(!draft.from||!draft.to)){
   notify('Selecione as datas inicial e final para um período personalizado','error');
   return;
  }
  if(draft.days==='custom'&&draft.from>draft.to){
   notify('A data inicial não pode ser posterior à final','error');
   return;
  }
  setPage(1);setApplied({...draft});
 };
 const reset=()=>{setPage(1);setDraft(initial);setApplied(initial);setRevision(v=>v+1)};
 const download=async()=>{
  setDownloading(true);
  try{
   const blob=await api('/api/reports/export?'+activityQuery);
   if(!(blob instanceof Blob))throw new Error('O servidor não retornou um arquivo CSV');
   const url=URL.createObjectURL(blob);
   const anchor=document.createElement('a');
   anchor.href=url;
   anchor.download='brnotify-relatorio-'+(summary?.period.from||'inicio')+'-'+(summary?.period.to||'fim')+'.csv';
   document.body.appendChild(anchor);anchor.click();anchor.remove();
   window.setTimeout(()=>URL.revokeObjectURL(url),1500);
   notify('Exportação CSV concluída (máximo de 2.000 atividades).');
  }catch(e:any){notify(e.message,'error')}finally{setDownloading(false)}
 };
 const m=summary?.messages;
 const rate=summary?.delivery_rate;
 const countFmt=(value:unknown)=>fmtNum(Number(value||0));
 return <div className="report-page">
  <PageTitle eyebrow="ANÁLISE / OPERAÇÃO" title="Relatório geral"
   subtitle="Agendamentos, mensagens, confirmações e integrações em uma única visão."
   action={<div className="report-heading-actions"><Button secondary onClick={()=>setRevision(x=>x+1)}><RefreshCw size={17}/> Atualizar</Button><Button onClick={download} disabled={downloading||!summary}><ArrowDownToLine size={17}/>{downloading?'Exportando...':'Exportar CSV'}</Button></div>}/>
  <Card className="report-filter-card">
   <div className="report-filter-heading"><span><Filter size={17}/> Filtros do relatório</span><small>Todos os indicadores respeitam o período selecionado</small></div>
   <div className="report-filters">
    <div className="report-field report-period-field"><label>Período</label><div className="report-period-picker">{['7','30','90','custom'].map(n=><button type="button" className={draft.days===n?'report-period-active':''} key={n} onClick={()=>setDraft(d=>({...d,days:n}))}>{n==='custom'?'Personalizado':n+' dias'}</button>)}</div></div>
    {draft.days==='custom'&&<>
     <label className="report-field"><span>De</span><input type="date" value={draft.from} onChange={e=>setDraft(d=>({...d,from:e.target.value}))}/></label>
     <label className="report-field"><span>Até</span><input type="date" value={draft.to} onChange={e=>setDraft(d=>({...d,to:e.target.value}))}/></label>
    </>}
    <label className="report-field"><span>Origem</span><select value={draft.kind} onChange={e=>setDraft(d=>({...d,kind:e.target.value as Kind}))}>{categories.map(x=><option value={x.value} key={x.value}>{x.label}</option>)}</select></label>
    <label className="report-field"><span>Status</span><select value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value}))}>{statuses.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    <label className="report-field report-search"><span>Buscar atividade</span><div><Search size={16}/><input placeholder="Contato, evento ou ID externo" value={draft.q} onChange={e=>setDraft(d=>({...d,q:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')apply()}}/></div></label>
   </div>
   <div className="report-filter-foot"><span>Período máximo: 366 dias. Listagens: 20 itens por página.</span><div><button className="report-reset-button" onClick={reset}>Limpar</button><Button onClick={apply}>Aplicar filtros <ArrowRight size={16}/></Button></div></div>
  </Card>
  <ErrorHint error={summaryError}/>
  {summaryLoading&&!summary?<Loader/>:summary&&<>
   <div className="report-interval"><CalendarDays size={15}/> Período: <strong>{summary.period.from.split('-').reverse().join('/')} até {summary.period.to.split('-').reverse().join('/')}</strong><span> · fuso horário do ambiente</span></div>
   <section className="report-metrics" aria-label="Indicadores consolidados">
    <Metric title="Lembretes programados no período" value={countFmt(m?.total)} icon={Clock3} note="Todos os status" highlight/>
    <Metric title="Aceitos pela GoTo" value={countFmt(m?.accepted)} icon={Send} note="Mensagens com registro de envio"/>
    <Metric title="Entregues" value={countFmt(m?.delivered)} icon={CheckCheck} note="Status confirmado pela GoTo"/>
    <Metric title="Falhas de envio" value={countFmt(m?.failed)} icon={AlertTriangle} note="Requerem avaliação"/>
    <Metric title="Confirmações" value={countFmt(summary.confirmations.confirmed)} icon={Users} note="Respostas confirmadas no período"/>
    <Metric title="Reagendamentos" value={countFmt(summary.confirmations.reschedule_requested)} icon={CalendarDays} note="Solicitações recebidas"/>
   </section>
   <section className="report-main-grid">
    <Trend summary={summary}/>
    <Card className="report-rate-card">
     <div className="report-card-head"><div><span className="report-eyebrow">ENTREGABILIDADE</span><h2>Saúde dos disparos</h2><p>Aceitos e entregues no período</p></div><CheckCheck size={21}/></div>
     <div className="report-rate-value">{rate==null?'—':rate.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}<span>Taxa de entrega</span></div>
     <div className="report-rate-track"><span style={{width:(rate||0)+'%'}}/></div>
     <div className="report-rate-explanation">Entregues ÷ mensagens com registro de envio. Não inclui os lembretes ainda na fila.</div>
     <div className="report-rate-stats">
      <div><span>Na fila</span><strong>{countFmt(m?.scheduled)}</strong></div>
      <div><span>Indeterminados</span><strong>{countFmt(m?.unknown)}</strong></div>
      <div><span>Cancelados</span><strong>{countFmt(m?.cancelled)}</strong></div>
     </div>
    </Card>
   </section>
   <section className="report-aux-grid">
    <Card className="report-operations-card">
     <div className="report-card-head"><div><span className="report-eyebrow">DADOS E AGENDAMENTOS</span><h2>Operação consolidada</h2><p>Indicadores em um único painel</p></div><BarChart3 size={20}/></div>
     <div className="report-summary-stats">
      <div><CalendarDays size={17}/><span>Agendamentos na data</span><strong>{countFmt(summary.appointments.total)}</strong></div>
      <div><Users size={17}/><span>Novos contatos</span><strong>{countFmt(summary.contacts.created)}</strong></div>
      <div><FileSpreadsheet size={17}/><span>Importados</span><strong>{countFmt(summary.imports.imported)}</strong></div>
      <div><FileSpreadsheet size={17}/><span>Rejeitados na importação</span><strong>{countFmt(summary.imports.rejected)}</strong></div>
      <div><Link2 size={17}/><span>Chamadas à API</span><strong>{countFmt(summary.api.total)}</strong></div>
      <div><Webhook size={17}/><span>Webhooks entregues</span><strong>{countFmt(summary.webhooks.delivered)}</strong></div>
      <div><AlertTriangle size={17}/><span>Erros de API</span><strong>{countFmt(summary.api.failed)}</strong></div>
      <div><AlertTriangle size={17}/><span>Webhooks com falha</span><strong>{countFmt(summary.webhooks.failed)}</strong></div>
     </div>
    </Card>
    <Card className="report-errors-card">
     <div className="report-card-head"><div><span className="report-eyebrow">DIAGNÓSTICO</span><h2>Principais falhas</h2><p>Códigos de erro dos disparos</p></div><AlertTriangle size={19}/></div>
     {summary.top_errors.length?<div className="report-error-list">{summary.top_errors.map((item,i)=><div key={item.code} className="report-error-row">
       <span className="report-error-rank">{String(i+1).padStart(2,'0')}</span>
       <span><strong>{item.code}</strong><small>{item.description||'Nenhuma descrição fornecida'}</small></span>
       <b>{countFmt(item.count)}</b>
      </div>)}</div>:<Empty title="Sem falhas de envio" subtitle="Não foram registradas falhas neste período."/>}
    </Card>
   </section>
  </>}
  <Card className="report-activity-card">
   <div className="report-card-head"><div><span className="report-eyebrow">HISTÓRICO UNIFICADO</span><h2>Todas as atividades</h2><p>Mensagens, eventos, respostas, integrações e importações</p></div><span className="report-result-count">{fmtNum(activities.total)} registros</span></div>
   <ErrorHint error={activityError}/>
   {activityLoading?<div className="report-activity-loading">Atualizando atividades...</div>:activities.items.length?
    <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Data e hora</th><th>Origem</th><th>Contato / Integração</th><th>Atividade</th><th>Status</th><th>Detalhes</th></tr></thead><tbody>
     {activities.items.map(item=><tr key={item.kind+'-'+item.id}>
      <td className="report-date-cell">{fmtDate(item.occurred_at,true)}</td>
      <td><span className="report-source">{kindMap[item.kind]||item.kind}</span></td>
      <td><strong>{item.subject||'—'}</strong>{item.external_id&&<small>ID: {item.external_id}</small>}</td>
      <td><strong>{item.title}</strong></td>
      <td><span className={'report-status '+statusStyle(item.status)}>{statusMap[item.status]||item.status}</span></td>
      <td title={item.detail||''}><span className="report-detail">{item.detail||'—'}</span></td>
     </tr>)}
    </tbody></table></div>
    :<Empty title="Nenhum registro encontrado" subtitle="Altere os filtros ou aguarde novas movimentações."/>}
   <Pagination page={page} pages={activities.pages} onChange={setPage}/>
  </Card>
  <div className="report-footnote"><Activity size={15}/><span>Mensagens: data programada do disparo. Agendamentos: data do compromisso. Confirmações: data da resposta. APIs, webhooks e importações: data de criação do registro. Exportação limitada às 2.000 atividades mais recentes que correspondem aos filtros aplicados.</span></div>
 </div>;
}
