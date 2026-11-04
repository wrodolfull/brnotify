import {useState} from 'react';
import {AlertCircle,Clock3,RotateCcw,Send} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,PageTitle,Pagination,Status,useList} from '../components';
import {fmtDate} from '../api';
const options=[['','Todos'],['scheduled','Programados'],['sent','Enviados'],['delivered','Entregues'],['failed','Falhas'],['unknown','Indeterminados'],['cancelled','Cancelados']];
export function Messages(){
 const {api,role,notify}=useApp(),[status,setStatus]=useState('');
 const list=useList('/api/messages'+(status?'?status='+status:''));
 async function retry(id:string){if(!window.confirm('Deseja tentar novamente este disparo?'))return;try{await api('/api/messages/'+id+'/retry',{method:'POST'});notify('Reenvio agendado');list.refresh()}catch(e:any){notify(e.message,'error')}}
 return <><PageTitle eyebrow="MONITORAMENTO" title="Disparos" subtitle="Acompanhe os envios, entregas e possíveis falhas do WhatsApp."/>
 <Card><div className="toolbar"><div className="status-filters">{options.map(([value,label])=><button className={'filter-chip '+(status===value?'filter-active':'')} key={value} onClick={()=>{setStatus(value);list.setPage(1)}}>{label}</button>)}</div></div>
 <ErrorHint error={list.error}/>
 {list.data.items.length?<div className="messages-list">{list.data.items.map((m:any)=><div className="message-row" key={m.id}><div className="message-icon"><Send size={18}/></div><div className="message-content"><div className="message-row-top"><strong>{m.contact_name}</strong><Status value={m.status}/></div><div className="muted text-small">{m.event_title} · {m.phone}</div><div className="message-meta"><span><Clock3 size={14}/>{fmtDate(m.scheduled_at,true)}</span><span>Tentativas: {m.attempt_count}</span></div>{m.error_description&&<div className="message-error"><AlertCircle size={15}/>{m.error_description}</div>}</div>{m.status==='failed'&&role==='admin'&&<Button secondary onClick={()=>retry(m.id)}><RotateCcw size={15}/> Reenviar</Button>}</div>)}</div>:!list.loading&&<Empty title="Nenhum disparo neste filtro" subtitle="Os envios automáticos e resultados da GoTo aparecerão aqui."/>}
 <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/></Card></>;
}
