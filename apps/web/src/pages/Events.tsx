import {useEffect,useState,type FormEvent} from 'react';
import {CalendarDays,ChevronRight,Clock3,UserRound,Search} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Modal,NewButton,PageTitle,Pagination,Status,SubmitRow,formValues,useList} from '../components';
import {fmtDate} from '../api';

export function Events(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const list=useList('/api/events');
 const [modal,setModal]=useState(false),[contacts,setContacts]=useState<any[]>([]),[records,setRecords]=useState<any[]>([]),[contactId,setContactId]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<any>(null);
 const [overrides,setOverrides]=useState(false),[slots,setSlots]=useState<{enabled:boolean;offset_value:number;offset_unit:'days'|'weeks'|'months'}[]>([{enabled:true,offset_value:1,offset_unit:'months'},{enabled:true,offset_value:3,offset_unit:'days'},{enabled:true,offset_value:1,offset_unit:'days'}]);
 const loadContacts=async(q:string)=>{try{const r=await api('/api/contacts?q='+encodeURIComponent(q));setContacts(r.items)}catch(e:any){setError(e.message)}};
 useEffect(()=>{if(modal)loadContacts(search)},[modal,search]);
 useEffect(()=>{if(!contactId){setRecords([]);return}api('/api/records?contact_id='+contactId).then(r=>setRecords(r.items||[])).catch(()=>setRecords([]))},[contactId,api]);
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');const v=formValues(e);
  try{
   const reminder_overrides=overrides?Object.fromEntries(slots.map((slot,i)=>[String(i+1),slot])):null;
   await api('/api/events',{method:'POST',body:JSON.stringify({contact_id:v.contact_id,record_id:v.record_id||null,title:v.title,event_type:v.event_type,starts_at:v.starts_at,reminder_overrides,confirmation_enabled:v.confirmation_enabled==='on'})});
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
 {modal&&<Modal title="Agendar evento" onClose={()=>setModal(false)}><form className="form-stack" onSubmit={save}><label className="field"><span>Encontrar contato</span><div className="search-box"><Search size={17}/><input placeholder="Buscar por nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div></label><label className="field"><span>Contato *</span><select name="contact_id" required defaultValue="" onChange={e=>setContactId(e.target.value)}><option value="" disabled>Selecione um contato</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}</select></label><label className="field"><span>Registro associado (opcional)</span><select name="record_id"><option value="">Nenhum registro</option>{records.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><div className="form-grid"><Input name="title" label="Título do evento" required placeholder="Ex.: Revisão anual"/><Input name="event_type" label="Tipo de lembrete" placeholder="Revisão"/></div><Input name="starts_at" type="datetime-local" label="Data e hora do evento" required/>
 <div className="form-panel">
  <label className="checkbox-row"><input type="checkbox" name="confirmation_enabled"/> Solicitar confirmação do agendamento pelo WhatsApp</label>
  <p className="muted">Requer template GoTo aprovado com instruções de resposta, webhook INBOUND_MESSAGE ativo e apenas um evento pendente identificável para o contato.</p>
 </div>
 <div className="form-panel"><label className="checkbox-row"><input type="checkbox" checked={overrides} onChange={e=>setOverrides(e.target.checked)}/> Personalizar lembretes deste evento</label>{overrides&&<div className="override-row">{slots.map((slot,i)=><div key={i} className="override-item"><label className="checkbox-row"><input type="checkbox" checked={slot.enabled} onChange={e=>setSlots(s=>s.map((v,index)=>i===index?{...v,enabled:e.target.checked}:v))}/> Lembrete {i+1}</label>{slot.enabled&&<div className="form-grid"><label className="field"><span>Antecedência</span><input type="number" min={1} max={365} value={slot.offset_value} onChange={e=>setSlots(s=>s.map((v,index)=>i===index?{...v,offset_value:Number(e.target.value)}:v))}/></label><label className="field"><span>Unidade</span><select value={slot.offset_unit} onChange={e=>setSlots(s=>s.map((v,index)=>i===index?{...v,offset_unit:e.target.value as 'days'|'weeks'|'months'}:v))}><option value="days">Dias</option><option value="weeks">Semanas</option><option value="months">Meses</option></select></label></div>}</div>)}</div>}<p className="muted">Sem personalização, serão utilizadas as regras do ambiente.</p></div><ErrorHint error={error}/><SubmitRow onCancel={()=>setModal(false)} busy={busy} label="Criar evento"/></form></Modal>}
 {selected&&<Modal title="Evento" onClose={()=>setSelected(null)}><div className="detail-section"><h2>{selected.title}</h2><div className="mini-line"><UserRound size={17}/>{selected.contact_name}</div><div className="mini-line"><Clock3 size={17}/>{fmtDate(selected.starts_at,true)}</div><div className="mini-line">Status: <Status value={selected.status}/></div>
 <div className="mini-line">Confirmação: <strong>{({not_requested:'Não solicitada',pending:'Aguardando',confirmed:'Confirmado',reschedule_requested:'Solicitou reagendamento',declined:'Recusado'} as Record<string,string>)[selected.confirmation_status]||'—'}</strong></div></div>{canEdit&&selected.status==='scheduled'&&<footer className="form-footer"><Button secondary onClick={()=>changeStatus('cancelled')}>Cancelar evento</Button><Button onClick={()=>changeStatus('completed')}>Marcar concluído</Button></footer>}</Modal>}
 </>;
}
