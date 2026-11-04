import {useEffect,useState,type FormEvent} from 'react';
import {CarFront,ChevronRight,Mail,Phone,Plus,UserRound,CalendarDays} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Modal,NewButton,PageTitle,Pagination,SearchBox,SubmitRow,formValues,useList} from '../components';
import {fmtDate} from '../api';

export function Contacts(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const [q,setQ]=useState(''),[modal,setModal]=useState(false),[selected,setSelected]=useState<any>(null),[records,setRecords]=useState<any[]>([]),[events,setEvents]=useState<any[]>([]),[recordModal,setRecordModal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const list=useList('/api/contacts?q='+encodeURIComponent(q));
 const open=async(c:any)=>{setSelected(c);setRecords([]);setEvents([]);const [a,b]=await Promise.all([api('/api/records?contact_id='+c.id),api('/api/events?contact_id='+c.id)]);setRecords(a.items);setEvents(b.items)};
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');const v=formValues(e);try{
  await api('/api/contacts',{method:'POST',body:JSON.stringify({name:v.name,phone:v.phone,email:v.email,consent:v.consent==='on',consent_source:v.consent_source})});
  notify('Contato cadastrado');setModal(false);list.refresh()
 }catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const addRecord=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');const v=formValues(e);try{
  await api('/api/records',{method:'POST',body:JSON.stringify({contact_id:selected.id,label:v.label,kind:v.kind,details:{description:v.description}})});
  notify('Registro associado');setRecordModal(false);await open(selected)
 }catch(e:any){setError(e.message)}finally{setBusy(false)}};
 return <><PageTitle eyebrow="CADASTROS" title="Contatos" subtitle="Uma base organizada para todos os seus lembretes." action={canEdit?<NewButton onClick={()=>{setError('');setModal(true)}} label="Novo contato"/>:null}/>
 <Card><div className="toolbar"><SearchBox value={q} onChange={v=>{setQ(v);list.setPage(1)}} placeholder="Buscar por nome ou WhatsApp"/><span className="toolbar-count">{list.data.total} contatos</span></div>
 {list.error&&<ErrorHint error={list.error}/>}
 {list.data.items.length?<div className="data-list">{list.data.items.map((c:any)=><button className="data-row" key={c.id} onClick={()=>open(c)}><span className="list-avatar">{c.name.slice(0,1).toUpperCase()}</span><span className="row-main"><strong>{c.name}</strong><small>{c.phone} {c.email?'· '+c.email:''}</small></span><span className={'consent-pill '+(c.consent&&!c.opted_out_at?'consent-yes':'consent-no')}>{c.consent&&!c.opted_out_at?'Autorizado':'Sem autorização'}</span><ChevronRight size={18}/></button>)}</div>:!list.loading&&<Empty title="Nenhum contato encontrado" subtitle="Cadastre individualmente ou importe uma planilha."/>}
 <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/></Card>
 {modal&&<Modal title="Cadastrar contato" onClose={()=>setModal(false)}><form className="form-stack" onSubmit={submit}><Input name="name" label="Nome completo" required placeholder="Nome do cliente"/><div className="form-grid"><Input name="phone" label="WhatsApp com DDD" required placeholder="(19) 99999-9999"/><Input name="email" label="E-mail (opcional)" type="email" placeholder="cliente@email.com"/></div><label className="checkbox-row"><input type="checkbox" name="consent"/> O contato autorizou receber mensagens via WhatsApp</label><Input name="consent_source" label="Origem do consentimento" placeholder="Ex.: formulário assinado em loja"/><ErrorHint error={error}/><SubmitRow onCancel={()=>setModal(false)} busy={busy} label="Cadastrar contato"/></form></Modal>}
 {selected&&<Modal title="Detalhes do contato" onClose={()=>setSelected(null)}><div className="detail-profile"><div className="detail-big-avatar">{selected.name.slice(0,1).toUpperCase()}</div><div><h3>{selected.name}</h3><p><Phone size={15}/>{selected.phone}</p>{selected.email&&<p><Mail size={15}/>{selected.email}</p>}</div></div>
 <div className="detail-section"><div className="detail-heading"><h3>Registros associados</h3>{canEdit&&<button className="tiny-action" onClick={()=>{setError('');setRecordModal(true)}}><Plus size={15}/> Novo</button>}</div>{records.length?records.map(x=><div className="mini-line" key={x.id}><CarFront size={17}/><span>{x.label}</span></div>):<p className="muted">Nenhum registro associado.</p>}</div>
 <div className="detail-section"><div className="detail-heading"><h3>Eventos</h3></div>{events.length?events.map(x=><div className="mini-line" key={x.id}><CalendarDays size={17}/><span>{x.title}</span><small>{fmtDate(x.starts_at)}</small></div>):<p className="muted">Nenhum evento cadastrado.</p>}</div>
 </Modal>}
 {recordModal&&selected&&<Modal title="Novo registro associado" onClose={()=>setRecordModal(false)}><form onSubmit={addRecord} className="form-stack"><Input name="label" label="Identificação" placeholder="Ex.: Corolla / Rex / Consulta" required/><label className="field"><span>Categoria</span><select name="kind"><option value="generic">Geral</option><option value="vehicle">Veículo</option><option value="pet">Pet</option><option value="appointment">Atendimento</option></select></label><Input name="description" label="Descrição (opcional)"/><ErrorHint error={error}/><SubmitRow onCancel={()=>setRecordModal(false)} busy={busy}/></form></Modal>}
 </>;
}
