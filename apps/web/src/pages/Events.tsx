import {useEffect,useState,type FormEvent} from 'react';
import {CalendarDays,ChevronRight,Clock3,UserRound,Search} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Modal,NewButton,PageTitle,Pagination,Status,SubmitRow,formValues,useList} from '../components';
import {fmtDate} from '../api';

type DeliveryMode='automation'|'custom';
type RuleOverride={enabled:boolean;offset_value:number;offset_unit:'days'|'weeks'|'months'};
type Preview={delivery_mode:DeliveryMode;can_schedule:boolean;reminders:{slot:number;scheduled_at:string;template_id:string;template_name:string}[];warnings:string[];timezone:string};
const initialSlots:RuleOverride[]=[
 {enabled:true,offset_value:1,offset_unit:'months'},
 {enabled:true,offset_value:3,offset_unit:'days'},
 {enabled:true,offset_value:1,offset_unit:'days'}
];

export function Events(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const list=useList('/api/events');
 const [modal,setModal]=useState(false),[contacts,setContacts]=useState<any[]>([]),[records,setRecords]=useState<any[]>([]);
 const [contactId,setContactId]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<any>(null),[notifications,setNotifications]=useState<any[]>([]),[notificationsLoading,setNotificationsLoading]=useState(false),[notificationsError,setNotificationsError]=useState('');
 const [overrides,setOverrides]=useState(false),[slots,setSlots]=useState<RuleOverride[]>(initialSlots);
 const [deliveryMode,setDeliveryMode]=useState<DeliveryMode>('automation');
 const [eventStart,setEventStart]=useState(''),[customSendAt,setCustomSendAt]=useState(''),[customTemplateId,setCustomTemplateId]=useState('');
 const [templates,setTemplates]=useState<{id:string;name:string;language_code:string}[]>([]);
 const [preview,setPreview]=useState<Preview|null>(null),[previewLoading,setPreviewLoading]=useState(false),[previewError,setPreviewError]=useState('');

 const overridePayload=()=>overrides&&deliveryMode==='automation'?
  Object.fromEntries(slots.map((slot,i)=>[String(i+1),slot])):null;

 const loadContacts=async(q:string)=>{try{const r=await api('/api/contacts?q='+encodeURIComponent(q));setContacts(r.items||[])}catch(e:any){setError(e.message)}};
 useEffect(()=>{if(modal)void loadContacts(search)},[modal,search,api]);
 useEffect(()=>{
  if(!modal)return;
  let active=true;
  api('/api/templates/options').then(r=>{if(active)setTemplates(r.items||[])}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[modal,api]);
 useEffect(()=>{
  if(!contactId){setRecords([]);return}
  let active=true;
  api('/api/records?contact_id='+contactId).then(r=>{if(active)setRecords(r.items||[])}).catch(()=>{if(active)setRecords([])});
  return()=>{active=false};
 },[contactId,api]);
 useEffect(()=>{
  if(!selected){setNotifications([]);setNotificationsError('');return}
  let active=true;
  setNotifications([]);setNotificationsLoading(true);setNotificationsError('');
  api('/api/events/'+selected.id+'/notifications')
   .then(r=>{if(active)setNotifications(r.items||[])})
   .catch(e=>{if(active)setNotificationsError(e.message)})
   .finally(()=>{if(active)setNotificationsLoading(false)});
  return()=>{active=false};
 },[selected?.id,api]);
 useEffect(()=>{
  if(!modal||!contactId||!eventStart||(deliveryMode==='custom'&&(!customSendAt||!customTemplateId))){
   setPreview(null);setPreviewError('');setPreviewLoading(false);return;
  }
  let active=true;
  setPreview(null);setPreviewError('');setPreviewLoading(true);
  const timer=setTimeout(()=>{
   api('/api/events/preview',{method:'POST',body:JSON.stringify({
    contact_id:contactId,starts_at:eventStart,delivery_mode:deliveryMode,
    ...(deliveryMode==='custom'?{custom_send_at:customSendAt,custom_template_id:customTemplateId}:{}),
    reminder_overrides:overridePayload()
   })}).then(result=>{if(active)setPreview(result)})
    .catch(e=>{if(active)setPreviewError(e.message)})
    .finally(()=>{if(active)setPreviewLoading(false)});
  },350);
  return()=>{active=false;clearTimeout(timer)};
 },[modal,api,contactId,eventStart,deliveryMode,customSendAt,customTemplateId,overrides,slots]);

 function openCreate(){
  setModal(true);setError('');setSearch('');setContactId('');setEventStart('');setCustomSendAt('');
  setCustomTemplateId('');setDeliveryMode('automation');setOverrides(false);setSlots(initialSlots);
  setPreview(null);setPreviewError('');
 }
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const v=formValues(e);
  try{
   const result=await api('/api/events',{method:'POST',body:JSON.stringify({
    contact_id:v.contact_id,record_id:v.record_id||null,title:v.title,
    event_type:v.event_type,starts_at:eventStart,
    reminder_overrides:overridePayload(),confirmation_enabled:v.confirmation_enabled==='on',
    delivery_mode:deliveryMode,
    ...(deliveryMode==='custom'?{custom_send_at:customSendAt,custom_template_id:customTemplateId}:{})
   })});
   const count=Number(result.reminders_scheduled||0);
   if(count>0)notify('Compromisso criado. '+count+' disparo(s) programado(s).');
   else notify('Compromisso criado, mas nenhum WhatsApp foi programado. Verifique as regras e o consentimento.','error');
   setModal(false);list.refresh();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function changeStatus(status:'cancelled'|'completed'){
  try{
   await api('/api/events/'+selected.id,{method:'PATCH',body:JSON.stringify({status})});
   notify('Evento atualizado');setSelected(null);list.refresh();
  }catch(e:any){notify(e.message,'error')}
 }
 const activeMessages=notifications.filter(m=>m.schedule_revision===selected?.schedule_revision);
 return <>
  <PageTitle eyebrow="LEMBRETES" title="Compromissos" subtitle="Cadastre um compromisso e envie lembretes antes da data marcada."
   action={canEdit?<NewButton label="Novo compromisso" onClick={openCreate}/>:null}/>
  <Card>
   <div className="card-heading"><div><h2>Próximos compromissos</h2><p>Ordenados pela data do compromisso</p></div><span className="toolbar-count">{list.data.total} compromissos</span></div>
   {list.error&&<ErrorHint error={list.error}/>}
   {list.data.items.length?<div className="data-list">{list.data.items.map((e:any)=>
    <button className="data-row" key={e.id} onClick={()=>setSelected(e)}>
     <span className="event-icon"><CalendarDays size={20}/></span>
     <span className="row-main"><strong>{e.title}</strong><small>{e.contact_name} · {e.record_label||'Sem registro adicional'}</small></span>
     <span className="event-date">{fmtDate(e.starts_at,true)}</span><Status value={e.status}/><ChevronRight size={18}/>
    </button>)}</div>:!list.loading&&<Empty title="Nenhum compromisso cadastrado" subtitle="Os lembretes serão programados a partir dos compromissos."/>}
   <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/>
  </Card>

  {modal&&<Modal title="Novo compromisso" onClose={()=>setModal(false)}>
   <form className="form-stack" onSubmit={save}>
    <label className="field"><span>Encontrar contato</span><div className="search-box"><Search size={17}/>
     <input placeholder="Buscar por nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div></label>
    <label className="field"><span>Contato *</span><select name="contact_id" required value={contactId} onChange={e=>setContactId(e.target.value)}>
     <option value="" disabled>Selecione um contato</option>
     {contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}
    </select></label>
    <label className="field"><span>Registro associado (opcional)</span><select name="record_id">
     <option value="">Nenhum registro</option>
     {records.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
    </select></label>
    <div className="form-grid"><Input name="title" label="Nome do compromisso" required placeholder="Ex.: Revisão anual"/>
     <Input name="event_type" label="Categoria (opcional)" placeholder="Revisão"/></div>
    <label className="field"><span>Data e hora do compromisso *</span>
     <input name="starts_at" type="datetime-local" required value={eventStart} onChange={e=>setEventStart(e.target.value)}/>
    </label>
    <div className="form-panel">
     <h3>Lembretes automáticos</h3>
     <p className="muted">O BR Notify usa os horários e modelos definidos nas regras de lembretes deste ambiente.</p>
    </div>
    {deliveryMode==='automation'&&<div className="form-panel">
     <label className="checkbox-row"><input type="checkbox" checked={overrides} onChange={e=>setOverrides(e.target.checked)}/>
      Personalizar os lembretes deste compromisso (opcional)</label>
     {overrides&&<div className="override-row">{slots.map((slot,i)=><div key={i} className="override-item">
      <label className="checkbox-row"><input type="checkbox" checked={slot.enabled}
       onChange={e=>setSlots(rows=>rows.map((r,j)=>i===j?{...r,enabled:e.target.checked}:r))}/>Lembrete {i+1}</label>
      {slot.enabled&&<div className="form-grid">
       <label className="field"><span>Antecedência</span><input type="number" min={1} max={365} value={slot.offset_value}
        onChange={e=>setSlots(rows=>rows.map((r,j)=>i===j?{...r,offset_value:Number(e.target.value)}:r))}/></label>
       <label className="field"><span>Unidade</span><select value={slot.offset_unit}
        onChange={e=>setSlots(rows=>rows.map((r,j)=>i===j?{...r,offset_unit:e.target.value as RuleOverride['offset_unit']}:r))}>
        <option value="days">Dias antes</option><option value="weeks">Semanas antes</option><option value="months">Meses antes</option>
       </select></label>
      </div>}</div>)}</div>}
     <p className="muted">Os horários e modelos continuam definidos nas regras do ambiente.</p>
    </div>}
    <div className="form-panel">
     <label className="checkbox-row"><input type="checkbox" name="confirmation_enabled"/> Solicitar confirmação do compromisso pelo WhatsApp</label>
     <p className="muted">A resposta exige um template apropriado e webhook INBOUND_MESSAGE ativo.</p>
    </div>
    <div className="event-preview" role="status" aria-live="polite">
     <h3>Mensagens que serão programadas</h3>
     {!contactId||!eventStart||(deliveryMode==='custom'&&(!customSendAt||!customTemplateId))?
      <p className="muted">Selecione o contato e a data do compromisso para consultar os lembretes.</p>:
      previewLoading?<p className="muted">Calculando horários de envio...</p>:
      previewError?<ErrorHint error={previewError}/>:
      preview?<><strong>{preview.reminders.length?preview.reminders.length+' WhatsApp(s) programado(s)':'Nenhum WhatsApp será programado'}</strong>
       {preview.reminders.map(reminder=><div className="event-preview-row" key={reminder.slot}>
        <Clock3 size={16}/><span>{fmtDate(reminder.scheduled_at,true)} · {reminder.template_name}</span>
       </div>)}
       {preview.warnings.map((warning,i)=><p className="event-preview-warning" key={i}>{warning}</p>)}
      </>:<p className="muted">Carregando prévia...</p>}
    </div>
    <ErrorHint error={error}/>
    <SubmitRow onCancel={()=>setModal(false)} busy={busy||(deliveryMode==='custom'&&(!preview?.can_schedule||previewLoading||!!previewError))} label="Criar compromisso"/>
   </form>
  </Modal>}

  {selected&&<Modal title="Evento" onClose={()=>setSelected(null)}>
   <div className="detail-section">
    <h2>{selected.title}</h2>
    <div className="mini-line"><UserRound size={17}/>{selected.contact_name}</div>
    <div className="mini-line"><CalendarDays size={17}/>{fmtDate(selected.starts_at,true)} (compromisso)</div>
    <div className="mini-line">Status do evento: <Status value={selected.status}/></div>
    <div className="mini-line">Modo: <strong>{selected.delivery_mode==='custom'?'Disparo personalizado':'Regras de Automações'}</strong></div>
    <div className="mini-line">Confirmação: <strong>{({not_requested:'Não solicitada',pending:'Aguardando',confirmed:'Confirmado',reschedule_requested:'Solicitou reagendamento',declined:'Recusado'} as Record<string,string>)[selected.confirmation_status]||'—'}</strong></div>
    <div className="event-notification-details">
     <div className="event-notification-heading"><h3>WhatsApp / Disparos</h3>
      <button type="button" className="text-link" onClick={()=>{
       setNotificationsLoading(true);
       api('/api/events/'+selected.id+'/notifications').then(r=>{setNotifications(r.items||[]);setNotificationsError('')}).catch(e=>setNotificationsError(e.message)).finally(()=>setNotificationsLoading(false));
      }}>Atualizar status</button>
     </div>
     {notificationsLoading?<p className="muted">Carregando disparos...</p>:
      notificationsError?<ErrorHint error={notificationsError}/>:
      activeMessages.length?activeMessages.map((m:any)=><div className="event-notification-row" key={m.id}>
       <div><strong>{m.template_name||'Template'}</strong>
        <small>Envio previsto: {fmtDate(m.scheduled_at,true)}</small>
        {m.sent_at&&<small>Aceito pela GoTo: {fmtDate(m.sent_at,true)}</small>}
        {m.error_description&&<small className="event-preview-warning">{m.error_description}</small>}
       </div><Status value={m.status}/></div>):
      <p className="event-preview-warning">Nenhum WhatsApp programado para este evento. Confira a data, o consentimento e as regras.</p>}
    </div>
   </div>
   {canEdit&&selected.status==='scheduled'&&<footer className="form-footer">
    <Button secondary onClick={()=>changeStatus('cancelled')}>Cancelar evento</Button>
    <Button onClick={()=>changeStatus('completed')}>Marcar concluído</Button>
   </footer>}
  </Modal>}
 </>;
}
