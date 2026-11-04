import {useEffect,useState} from 'react';
import {CalendarCheck2,CheckCheck,Clock3,Send,Users,AlertTriangle,ArrowUpRight,ArrowRight} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useApp} from '../context';
import {Card,PageTitle,Loader,Empty,Status} from '../components';
import {fmtNum,fmtDate} from '../api';
export function Dashboard(){
 const {api,tenantName}=useApp(),[data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{api('/api/dashboard').then(setData).catch(e=>setError(e.message))},[api]);
 if(!data&&!error)return <Loader/>;
 const m=data?.messages||{};
 const metrics=[
  {label:'Lembretes programados',value:m.scheduled,icon:Clock3,kind:'blue'},
  {label:'Mensagens enviadas',value:m.sent,icon:Send,kind:'neutral'},
  {label:'Entregues',value:m.delivered,icon:CheckCheck,kind:'neutral'},
  {label:'Falhas identificadas',value:m.failed,icon:AlertTriangle,kind:'neutral'}
 ];
 return <><PageTitle eyebrow="PAINEL DE CONTROLE" title="Visão geral" subtitle={'Acompanhe o que está acontecendo em '+tenantName+'.'}/>
 {error&&<div className="inline-error">{error}</div>}
 <div className="metrics-grid">{metrics.map(x=><Card key={x.label} className={'metric-card metric-'+x.kind}><div className="metric-top"><span>{x.label}</span><x.icon size={20}/></div><div className="metric-value">{fmtNum(x.value)}</div><div className="metric-foot">Atualizado em tempo real ao recarregar</div></Card>)}</div>
 <div className="dashboard-grid">
  <Card className="dash-activity"><div className="card-heading"><div><div className="eyebrow">ATIVIDADE</div><h2>Últimos disparos</h2></div><Link to="/messages" className="text-link arrow-link">Ver todos <ArrowUpRight size={16}/></Link></div>
   {!data?.recent?.length?<Empty title="Nenhum disparo por enquanto" subtitle="Configure um template e cadastre o primeiro evento para acompanhar seus disparos."/>:<div className="activity-list">{data.recent.map((r:any)=><div className="activity-item" key={r.id}><div className="activity-dot"><Send size={15}/></div><div className="activity-text"><strong>{r.name}</strong><span>{r.title} · {fmtDate(r.scheduled_at,true)}</span>{r.error_description&&<small className="error-text">{r.error_description}</small>}</div><Status value={r.status}/></div>)}</div>}
  </Card>
  <div className="dashboard-side"><Card className="dash-summary"><div className="eyebrow">BASE CADASTRADA</div><h2>Sua operação</h2><div className="summary-line"><span><Users size={18}/> Contatos</span><strong>{fmtNum(data?.contacts)}</strong></div><div className="summary-line"><span><CalendarCheck2 size={18}/> Eventos futuros</span><strong>{fmtNum(data?.events)}</strong></div><div className="summary-line"><span><Clock3 size={18}/> Em processamento</span><strong>{fmtNum(m.processing)}</strong></div><div className="summary-line"><span><AlertTriangle size={18}/> Resultado indeterminado</span><strong>{fmtNum(m.unknown)}</strong></div></Card>
   <div className="callout-next"><div><div className="eyebrow">PRÓXIMO PASSO</div><h3>Seu fluxo, no automático.</h3><p>Cadastre um cliente, defina a data e deixe os lembretes com o BR Notify.</p></div><Link to="/events">Novo evento <ArrowRight size={17}/></Link></div>
  </div>
 </div></>;
}
