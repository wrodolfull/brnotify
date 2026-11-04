import {useEffect,useState,type FormEvent} from 'react';
import {CalendarDays,ChevronRight,Clock3,UserRound,Search} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Modal,NewButton,PageTitle,Pagination,Status,SubmitRow,formValues,useList} from '../components';
import {fmtDate} from '../api';

export function Events(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const list=useList('/api/events');
 const [modal,setModal]=useState(false),[contacts,setContacts]=useState<any[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<any>(null);
 const [overrides,setOverrides]=useState(false),[slots,setSlots]=useState([true,true,true]);
 const loadContacts=async(q:string)=>{try{const r=await api('/api/contacts?q='+encodeURIComponent(q));setContacts(r.items)}catch(e:any){setError(e.message)}};
 useEffect(()=>{if(modal)loadContacts(search)},[modal,search]);
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');const v=formValues(e);
  try{
   const reminder_overrides=overrides?Object.fromEntries(slots.map((enabled,i)=>[String(i+1),{enabled}])):null;
   await api('/api/events',{method:'POST',body:JSON.stringify({contact_id:v.contact_id,title:v.title,event_type:v.event_type,starts_at:v.starts_at,reminder_overrides})});
   notify('Evento criado e lembretes programados');setModal(false);list.refresh()
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function changeStatus(status:'cancelled'|'completed'){
  try{await api('/api/events/'+selected.id,{method:'PATCH',body:JSON.stringify({status})});notify('Evento atualizado');setSelected(null);list.refresh()}catch(e:any){notify(e.message,'error')}
 }
 return <><PageTitle eyebrow="AGENDAMENTOS" title="Eventos" subtitle="Datas importantes que geram lembretes automaticamente." action={canEdit?<NewButton label="Novo evento" onClick={()=>{setError('');setModal(true)}}/>:null}/>
 <Card><div className="card-heading"><div><h2>Todos os eventos</h2><p>Ordenados pela data do agendamento</p></div><span className="toolbar-count">{list.data.total} eventos</span></div>
 {list.error&&<ErrorHint error={list.error}/>}
 {list.data.items.length?<div className="data-list">{list.data.items.map((e:any)=><button className="data-row" key={e.id} onClick={()=>setSelected(e)}><span className="event-icon"><CalendarDays size={20}/></span><span className="row-main"><strong>{e.title}</strong><small>{e.contact_name} · {e.record_label||'Sem registro adicional'}</small></span><span className="event-date">{fmtDate(e.starts_at,true)}</span><Status value={e.status==='scheduled'?'scheduled':e.status}/><ChevronRight size={18}/></button>)}</div>:!list.loading&&<Empty title="Ainda não há eventos" subtitle="Cadastre um evento com data e cliente para iniciar as automações."/>}
 <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/></Card>
 {modal&&<Modal title="Agendar evento" onClose={()=>setModal(false)}><form className="form-stack" onSubmit={save}><label className="field"><span>Encontrar contato</span><div className="search-box"><Search size={17}/><input placeholder="Buscar por nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div></label><label className="field"><span>Contato *</span><select name="contact_id" required defaultValue=""><option value="" disabled>Selecione um contato</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}</select></label><div className="form-grid"><Input name="title" label="Título do evento" required placeholder="Ex.: Revisão anual"/><Input name="event_type" label="Tipo de lembrete" placeholder="Revisão"/></div><Input name="starts_at" type="datetime-local" label="Data e hora do evento" required/><div className="form-panel"><label className="checkbox-row"><input type="checkbox" checked={overrides} onChange={e=>setOverrides(e.target.checked)}/> Personalizar lembretes deste evento</label>{overrides&&<div className="override-row">{slots.map((enabled,i)=><label key={i} className="checkbox-row"><input type="checkbox" checked={enabled} onChange={e=>setSlots(s=>s.map((v,index)=>i===index?e.target.checked:v))}/> Lembrete {i+1}</label>)}</div>}<p className="muted">Sem personalização, serão utilizadas as regras do ambiente.</p></div><ErrorHint error={error}/><SubmitRow onCancel={()=>setModal(false)} busy={busy} label="Criar evento"/></form></Modal>}
 {selected&&<Modal title="Evento" onClose={()=>setSelected(null)}><div className="detail-section"><h2>{selected.title}</h2><div className="mini-line"><UserRound size={17}/>{selected.contact_name}</div><div className="mini-line"><Clock3 size={17}/>{fmtDate(selected.starts_at,true)}</div><div className="mini-line">Status: <Status value={selected.status}/></div></div>{canEdit&&selected.status==='scheduled'&&<footer className="form-footer"><Button secondary onClick={()=>changeStatus('cancelled')}>Cancelar evento</Button><Button onClick={()=>changeStatus('completed')}>Marcar concluído</Button></footer>}</Modal>}
 </>;
}
