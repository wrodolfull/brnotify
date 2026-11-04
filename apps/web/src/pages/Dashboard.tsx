import {useEffect,useState} from 'react';
import {
 AlertTriangle,ArrowRight,ArrowUpRight,CalendarClock,CalendarDays,CheckCheck,
 ChevronRight,Clock3,RefreshCw,Send,Users,Workflow
} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useApp} from '../context';
import {Card,Empty,Loader,Status} from '../components';
import {fmtDate,fmtNum} from '../api';

type HistoryPoint={day:string;sent:number;delivered:number;failed:number};
type Reminder={id:string;name:string;title:string;scheduled_at:string};
type Activity=Reminder & {status:string;error_description:string|null};
type DashboardData={
 contacts:number;
 events:number;
 messages:{scheduled:number;processing:number;sent:number;delivered:number;failed:number;unknown:number};
 recent:Activity[];
 upcoming:Reminder[];
 trend:HistoryPoint[];
};
const formatDay=(iso:string)=>iso.slice(8,10)+'/'+iso.slice(5,7);
const metrics=[
 {key:'scheduled',label:'Programados',description:'Aguardando a data de envio',icon:Clock3,style:'primary'},
 {key:'sent',label:'Enviados',description:'Aguardando confirmação',icon:Send,style:'default'},
 {key:'delivered',label:'Entregues',description:'Recebidos no WhatsApp',icon:CheckCheck,style:'default'},
 {key:'failed',label:'Com falha',description:'Precisam de atenção',icon:AlertTriangle,style:'default'}
] as const;

export function Dashboard(){
 const {api,tenantName,role}=useApp();
 const [data,setData]=useState<DashboardData|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [period,setPeriod]=useState<7|14>(14);
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let mounted=true;
  setLoading(true);
  api('/api/dashboard').then((result:DashboardData)=>{
   if(mounted){setData(result);setError('')}
  }).catch((e:Error)=>{
   if(mounted)setError(e.message)
  }).finally(()=>{if(mounted)setLoading(false)});
  return()=>{mounted=false};
 },[api,refresh]);
 if(!data&&loading)return <Loader/>;
 if(!data&&error)return <div className="nd-state-error"><AlertTriangle size={25}/><h2>Não foi possível carregar o painel</h2><p>{error}</p><button className="nd-primary-button" onClick={()=>setRefresh(x=>x+1)}>Tentar novamente</button></div>;

 const m=data?.messages??{scheduled:0,processing:0,sent:0,delivered:0,failed:0,unknown:0};
 const trend=(data?.trend??[]).slice(-period);
 const max=Math.max(1,...trend.map(x=>Math.max(x.sent,x.delivered)));
 const totalSent=trend.reduce((n,x)=>n+x.sent,0);
 const totalDelivered=trend.reduce((n,x)=>n+x.delivered,0);
 const hasChart=trend.some(x=>x.sent||x.delivered);
 const steps=[
  {label:'Contatos',note:'Na sua base',value:data?.contacts||0,icon:Users},
  {label:'Eventos',note:'Agendados no futuro',value:data?.events||0,icon:CalendarDays},
  {label:'Lembretes',note:'Na fila de envio',value:m.scheduled,icon:Clock3},
  {label:'Entregas',note:'Confirmadas pela GoTo',value:m.delivered,icon:CheckCheck}
 ];
 const currentDate=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long'}).format(new Date());

 return <div className="nd-dashboard">
  <header className="nd-overview-heading">
   <div>
    <div className="nd-overline"><span className="nd-overline-dot"/> VISÃO DA OPERAÇÃO <span className="nd-overline-divider">/</span> {currentDate}</div>
    <h1>Seu painel<span className="nd-title-period">.</span></h1>
    <p>O que acontece com os lembretes de <strong>{tenantName}</strong>, em um só lugar.</p>
   </div>
   <div className="nd-heading-actions">
    <button type="button" className="nd-refresh-button" onClick={()=>setRefresh(x=>x+1)} disabled={loading} aria-label="Atualizar painel" title="Atualizar painel"><RefreshCw size={17} className={loading?'spin':''}/></button>
    {role==='admin'&&<Link className="nd-primary-button" to="/events"><CalendarClock size={17}/> Novo evento <ArrowUpRight size={16}/></Link>}
   </div>
  </header>
  {error&&<div className="inline-error" role="alert">{error} — exibindo os dados carregados anteriormente.</div>}

  <section aria-label="Indicadores de disparos" className="nd-metrics-grid">
   {metrics.map(metric=>{
    const Icon=metric.icon;
    return <Card key={metric.key} className={'nd-stat-card nd-stat-'+metric.style}>
     <div className="nd-stat-top"><span>{metric.label}</span><span className="nd-stat-icon"><Icon size={19} strokeWidth={1.85}/></span></div>
     <div className="nd-stat-number">{fmtNum(m[metric.key])}</div>
     <div className="nd-stat-detail"><span className="nd-stat-minidot"/>{metric.description}</div>
    </Card>
   })}
  </section>

  <div className="nd-content-grid">
   <Card className="nd-chart-card">
    <div className="nd-card-header">
     <div><span className="nd-section-eyebrow">DESEMPENHO</span><h2>Atividade de mensagens</h2><p>Envios aceitos e entregas registradas por dia</p></div>
     <div className="nd-period-switch" role="group" aria-label="Período do gráfico">
      {([7,14] as const).map(n=><button type="button" key={n} aria-pressed={period===n} className={period===n?'nd-selected':''} onClick={()=>setPeriod(n)}>{n} dias</button>)}
     </div>
    </div>
    <div className="nd-chart-totals">
     <div><span className="nd-dot nd-dot-ink"/> <strong>{fmtNum(totalSent)}</strong><span>Enviados</span></div>
     <div><span className="nd-dot nd-dot-blue"/> <strong>{fmtNum(totalDelivered)}</strong><span>Entregues</span></div>
    </div>
    <div className="nd-chart-container">
     <div className="nd-plot" role="img" aria-label={'Atividade dos últimos '+period+' dias: '+totalSent+' envios e '+totalDelivered+' entregas.'}>
      <div className="nd-chart-guide nd-chart-guide-top"/>
      <div className="nd-chart-guide nd-chart-guide-mid"/>
      <div className="nd-chart-guide nd-chart-guide-bottom"/>
      <div className="nd-chart-columns">
       {trend.map((point,index)=><div className="nd-chart-day" key={point.day} title={formatDay(point.day)+': '+point.sent+' enviados, '+point.delivered+' entregues'}>
        <div className="nd-chart-pair">
         <div className="nd-bar nd-bar-ink" style={{height:(point.sent/max*100)+'%'}}/>
         <div className="nd-bar nd-bar-blue" style={{height:(point.delivered/max*100)+'%'}}/>
        </div>
        <span className={'nd-day-label '+(period===14&&index%2===1?'nd-label-muted':'')}>{formatDay(point.day)}</span>
       </div>)}
      </div>
      {!hasChart&&<div className="nd-chart-empty">Os primeiros envios aparecerão aqui.</div>}
     </div>
    </div>
    <div className="nd-chart-footer"><span><span className="nd-blue-pin"/> Dados reais dos últimos {period} dias</span><Link to="/messages">Histórico completo <ArrowRight size={15}/></Link></div>
   </Card>

   <Card className="nd-upcoming-card">
    <div className="nd-card-header">
     <div><span className="nd-section-eyebrow">PRÓXIMOS PASSOS</span><h2>Na programação</h2><p>Os próximos lembretes da fila</p></div>
     <span className="nd-header-icon"><CalendarClock size={19}/></span>
    </div>
    {(data?.upcoming?.length??0)>0
     ?<div className="nd-upcoming-list">{data!.upcoming.map((item,i)=><div className="nd-upcoming-item" key={item.id}>
       <div className="nd-upcoming-order">{String(i+1).padStart(2,'0')}</div>
       <div className="nd-upcoming-copy"><strong>{item.name}</strong><span>{item.title}</span><small><Clock3 size={13}/>{fmtDate(item.scheduled_at,true)}</small></div>
       <ChevronRight size={15} className="nd-upcoming-arrow"/>
      </div>)}</div>
     :<div className="nd-small-empty"><CalendarClock size={31} strokeWidth={1.4}/><strong>Nada na fila por enquanto</strong><p>Os próximos lembretes aparecerão assim que forem programados.</p></div>
    }
    <Link className="nd-view-all" to="/events">Ver eventos <ArrowUpRight size={16}/></Link>
   </Card>
  </div>

  <div className="nd-secondary-grid">
   <Card className="nd-journey-card">
    <div className="nd-card-header"><div><span className="nd-section-eyebrow">AUTOMAÇÃO</span><h2>A jornada dos lembretes</h2><p>Uma visão rápida das etapas da sua operação</p></div><span className="nd-header-icon"><Workflow size={19}/></span></div>
    <div className="nd-journey-track">{steps.map((step,i)=>{
     const Icon=step.icon;
     return <div key={step.label} className="nd-journey-step">
      <div className={'nd-journey-symbol '+(i===3?'nd-journey-symbol-blue':'')}><Icon size={20} strokeWidth={1.9}/></div>
      <div className="nd-journey-count">{fmtNum(step.value)}</div>
      <div className="nd-journey-name">{step.label}</div><div className="nd-journey-note">{step.note}</div>
      {i<3&&<div className="nd-journey-connector"><span/></div>}
     </div>;
    })}</div>
    <div className="nd-journey-bottom"><span>Automação configurável por ambiente e por contato</span><Link to="/automations">Ver regras <ArrowRight size={15}/></Link></div>
   </Card>
   <Card className="nd-recent-card">
    <div className="nd-card-header"><div><span className="nd-section-eyebrow">ACOMPANHAMENTO</span><h2>Atividade recente</h2><p>Status das últimas movimentações</p></div><Link className="nd-header-arrow" to="/messages" title="Ver disparos" aria-label="Ver todos os disparos"><ArrowUpRight size={19}/></Link></div>
    {(data?.recent?.length??0)>0
     ?<div className="nd-recent-list">{data!.recent.slice(0,5).map(item=><div className="nd-recent-row" key={item.id}><div className="nd-person-avatar">{item.name.charAt(0).toUpperCase()}</div><div className="nd-recent-info"><strong>{item.name}</strong><span>{item.title} · {fmtDate(item.scheduled_at,true)}</span></div><Status value={item.status}/></div>)}</div>
     :<Empty title="Nenhuma atividade ainda" subtitle="Seus disparos e confirmações aparecerão aqui."/>
    }
   </Card>
  </div>
  {(m.failed>0||m.unknown>0)&&<Link to="/messages?status=failed" className="nd-attention-banner"><AlertTriangle size={19}/><span><strong>Atenção aos disparos</strong>Há {fmtNum(m.failed)} falhas e {fmtNum(m.unknown)} resultados indeterminados para analisar.</span><ArrowRight size={18}/></Link>}
 </div>;
}
