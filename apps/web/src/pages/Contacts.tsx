import {useEffect,useState,type FormEvent} from 'react';
import {CarFront,ChevronRight,Mail,Phone,Plus,UserRound,CalendarDays,Download,UploadCloud,Trash2} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Modal,NewButton,PageTitle,Pagination,SearchBox,SubmitRow,formValues,useList} from '../components';
import {fmtDate} from '../api';

const modelFields:Record<string,[string,string][]> = {
 automotive:[['brand','Marca'],['model','Modelo'],['plate','Placa'],['year','Ano'],['mileage','Quilometragem']],
 clinic:[['professional','Profissional'],['unit','Unidade'],['procedure','Procedimento']],
 pet:[['pet_name','Nome do pet'],['species','Espécie'],['breed','Raça']],
 custom:[['description','Descrição']]
};
export function Contacts(){
 const {api,role,notify,segment}=useApp(),canEdit=role==='admin';
 const [q,setQ]=useState(''),[tab,setTab]=useState<'active'|'inactive'>('active');
 const [checkedIds,setCheckedIds]=useState<string[]>([]);
 const [importModal,setImportModal]=useState(false),[importFile,setImportFile]=useState<File|null>(null);
 const [importPreview,setImportPreview]=useState<any>(null),[importResult,setImportResult]=useState<any>(null);
 const [modal,setModal]=useState(false),[selected,setSelected]=useState<any>(null),[rulesModal,setRulesModal]=useState(false),[contactRules,setContactRules]=useState<any[]>([]),[records,setRecords]=useState<any[]>([]),[events,setEvents]=useState<any[]>([]),[recordModal,setRecordModal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const list=useList('/api/contacts?state='+tab+'&q='+encodeURIComponent(q));
 const visibleIds=list.data.items.map(c=>c.id as string);
 const selectedVisible=checkedIds.filter(id=>visibleIds.includes(id));
 const allChecked=visibleIds.length>0&&visibleIds.every(id=>checkedIds.includes(id));
 function changeTab(next:'active'|'inactive'){
  setTab(next);setCheckedIds([]);list.setPage(1);setSelected(null);
 }
 function selectAll(checked:boolean){setCheckedIds(checked?visibleIds:[])}
 async function changeContactStatus(ids:string[],active:boolean){
  if(!ids.length||busy)return;
  const message=active
   ?'Reativar '+ids.length+' contato(s)? Os disparos cancelados anteriormente não serão reprogramados automaticamente.'
   :'Desativar '+ids.length+' contato(s)? Eles passarão para Inativos e os WhatsApps pendentes serão cancelados.';
  if(!window.confirm(message))return;
  setBusy(true);setError('');
  try{
   const result=await api('/api/contacts/status',{method:'PATCH',body:JSON.stringify({ids,active})});
   notify(result.updated+' contato(s) '+(active?'reativado(s)':'desativado(s)')+'.');
   setCheckedIds([]);setSelected(null);list.refresh();
  }catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
 }
 async function removeContacts(ids:string[]){
  if(!ids.length||busy)return;
  if(!window.confirm('Excluir DEFINITIVAMENTE '+ids.length+' contato(s)? Compromissos, registros e lembretes vinculados também serão apagados. Mensagens já enviadas não podem ser recuperadas.'))return;
  setBusy(true);setError('');
  try{
   await api('/api/contacts/bulk',{method:'DELETE',body:JSON.stringify({ids})});
   notify(ids.length+' contato(s) excluído(s).');
   setCheckedIds([]);setSelected(null);
   if(list.page>1&&list.data.items.length===ids.length)list.setPage(list.page-1);
   else list.refresh();
  }catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
 }
 async function downloadContactsFile(){
  try{
   const blob=await api('/api/contacts/import/template');
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='brnotify-modelo-contatos.xlsx';a.click();
   URL.revokeObjectURL(url);
  }catch(e:any){notify(e.message,'error')}
 }
 async function importContactSheet(preview:boolean){
  if(!importFile||busy)return;
  setBusy(true);setError('');
  try{
   const data=new FormData();data.append('file',importFile);
   const result=await api(preview?'/api/contacts/import/preview':'/api/contacts/import',{
    method:'POST',body:data
   });
   if(preview){setImportPreview(result);setImportResult(null)}
   else{setImportResult(result);setImportPreview(null);list.refresh();
    notify(result.imported+' contato(s) importado(s). '+result.existing+' já existiam e foram preservados.')}
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }

 const open=async(c:any)=>{setSelected(c);setContactRules([{enabled:true,offset_value:1,offset_unit:'months'},{enabled:true,offset_value:3,offset_unit:'days'},{enabled:true,offset_value:1,offset_unit:'days'}].map((r,i)=>({...r,...(c.reminder_overrides?.[String(i+1)]||{})})));setRecords([]);setEvents([]);const [a,b]=await Promise.all([api('/api/records?contact_id='+c.id),api('/api/events?contact_id='+c.id)]);setRecords(a.items);setEvents(b.items)};
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');const v=formValues(e);try{
  await api('/api/contacts',{method:'POST',body:JSON.stringify({
    name:v.name,phone:v.phone,email:v.email,consent:v.consent==='on',
    consent_source:v.consent==='on'?v.consent_source:null
   })});
  notify('Contato cadastrado');setModal(false);list.refresh()
 }catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const saveContactRules=async()=>{
  setBusy(true);setError('');
  try{
   const overrides=Object.fromEntries(contactRules.map((r,i)=>[String(i+1),r]));
   const updated=await api('/api/contacts/'+selected.id,{method:'PATCH',body:JSON.stringify({reminder_overrides:overrides})});
   setSelected(updated);setRulesModal(false);list.refresh();notify('Lembretes do contato atualizados');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 };
 const toggleConsent=async()=>{
  const enable=!(selected.consent&&!selected.opted_out_at);
  const source=enable?window.prompt('Qual é a origem da nova autorização para WhatsApp?'):null;
  if(enable&&!source?.trim())return;
  try{
   const changed=await api('/api/contacts/'+selected.id,{method:'PATCH',body:JSON.stringify(enable?{consent:true,consent_source:source}:{consent:false})});
   setSelected(changed);list.refresh();notify(enable?'Consentimento registrado':'Mensagens futuras bloqueadas');
  }catch(e:any){notify(e.message,'error')}
 };
 const addRecord=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');const v=formValues(e);try{
  const details=Object.fromEntries((modelFields[segment]||[]).filter(([key])=>!!v[key]).map(([key])=>[key,v[key]]));
  await api('/api/records',{method:'POST',body:JSON.stringify({contact_id:selected.id,label:v.label,kind:segment,details})});
  notify('Registro associado');setRecordModal(false);await open(selected)
 }catch(e:any){setError(e.message)}finally{setBusy(false)}};
 return <><PageTitle eyebrow="CADASTROS" title="Contatos"
  subtitle="Organize contatos ativos e inativos. Até 50 registros por página."
  action={canEdit?<div className="button-row">
   <Button secondary onClick={()=>{setError('');setImportModal(true);setImportPreview(null);setImportResult(null)}}><UploadCloud size={17}/> Importar planilha</Button>
   <NewButton onClick={()=>{setError('');setModal(true)}} label="Novo contato"/>
  </div>:null}/>
 <Card>
  <div className="contact-tabs" role="tablist" aria-label="Status de contatos">
   <button type="button" role="tab" aria-selected={tab==='active'} className={tab==='active'?'contact-tab active':'contact-tab'} onClick={()=>changeTab('active')}>Ativos</button>
   <button type="button" role="tab" aria-selected={tab==='inactive'} className={tab==='inactive'?'contact-tab active':'contact-tab'} onClick={()=>changeTab('inactive')}>Inativos</button>
  </div>
  <div className="toolbar">
   <SearchBox value={q} onChange={v=>{setQ(v);list.setPage(1);setCheckedIds([])}} placeholder="Buscar por nome ou WhatsApp"/>
   <span className="toolbar-count">{list.data.total} contatos {tab==='active'?'ativos':'inativos'}</span>
  </div>
  {canEdit&&list.data.items.length>0&&<div className="contact-selection-bar">
   <label className="checkbox-row"><input type="checkbox" checked={allChecked} onChange={e=>selectAll(e.target.checked)}/> Selecionar os {visibleIds.length} contatos desta página</label>
   <span>{selectedVisible.length} selecionado(s)</span>
   {selectedVisible.length>0&&<>
    <Button secondary disabled={busy} onClick={()=>void changeContactStatus(selectedVisible,tab==='inactive')}>
     {tab==='active'?'Desativar':'Reativar'}
    </Button>
    <Button danger secondary disabled={busy} onClick={()=>void removeContacts(selectedVisible)}><Trash2 size={16}/> Excluir</Button>
   </>}
  </div>}
  {list.error&&<ErrorHint error={list.error}/>}
  {list.data.items.length?<div className="data-list">{list.data.items.map((c:any)=>
   <div className="data-row static-row" key={c.id}>
    {canEdit&&<input type="checkbox" className="contact-row-check"
     aria-label={'Selecionar '+c.name} checked={checkedIds.includes(c.id)}
     onChange={e=>setCheckedIds(old=>e.target.checked?[...old.filter(id=>id!==c.id),c.id]:old.filter(id=>id!==c.id))}/>}
    <button type="button" className="contact-row-open" onClick={()=>void open(c)}>
     <span className="list-avatar">{c.name.slice(0,1).toUpperCase()}</span>
     <span className="row-main"><strong>{c.name}</strong><small>{c.phone} {c.email?'· '+c.email:''}</small></span>
     <span className={'consent-pill '+(c.consent&&!c.opted_out_at?'consent-yes':'consent-no')}>
      {c.consent&&!c.opted_out_at?'WhatsApp autorizado':'Sem autorização'}
     </span><ChevronRight size={18}/>
    </button>
   </div>)}</div>:!list.loading&&<Empty title="Nenhum contato encontrado" subtitle={tab==='active'?'Cadastre individualmente ou importe uma planilha.':'Os contatos desativados aparecerão nesta aba.'}/>}
  <Pagination page={list.page} pages={list.data.pages} onChange={v=>{setCheckedIds([]);list.setPage(v)}}/>
 </Card>
 {importModal&&<Modal title="Importar contatos" onClose={()=>{if(!busy)setImportModal(false)}}>
  <div className="form-stack">
   <p className="muted">Importe até 10.000 contatos por arquivo XLSX ou CSV (12 MB). A importação não cria compromissos nem envia WhatsApp.</p>
   <Button secondary onClick={()=>void downloadContactsFile()}><Download size={16}/> Baixar modelo Excel de contatos</Button>
   <label className="field"><span>Planilha de contatos</span>
    <input type="file" accept=".xlsx,.csv" onChange={e=>{
     setImportFile(e.target.files?.[0]||null);setImportPreview(null);setImportResult(null);setError('');
    }}/>
   </label>
   <p className="hint">Contatos já existentes serão ignorados. A importação não reativa contatos inativos nem autorizações revogadas. Consentimento SIM exige a origem real da autorização.</p>
   {importPreview&&<div className="form-panel">
    <strong>{importPreview.total} linhas · {importPreview.valid} válidas · {importPreview.invalid} inválidas · {importPreview.duplicates_in_file} duplicadas no arquivo</strong>
    {importPreview.errors?.map((e:any,i:number)=><p key={i} className="notify-alert">Linha {e.row}: {e.error}</p>)}
   </div>}
   {importResult&&<div className="success-line">
    {importResult.imported} importados · {importResult.existing} existentes preservados.
   </div>}
   <ErrorHint error={error}/>
   <div className="form-footer">
    <Button secondary disabled={busy} onClick={()=>setImportModal(false)}>Fechar</Button>
    <Button secondary disabled={!importFile||busy} onClick={()=>void importContactSheet(true)}>Validar planilha</Button>
    <Button disabled={busy||!importFile||!importPreview||importPreview.invalid>0} onClick={()=>void importContactSheet(false)}>Importar contatos</Button>
   </div>
  </div>
 </Modal>}
 {modal&&<Modal title="Cadastrar contato" onClose={()=>setModal(false)}><form className="form-stack" onSubmit={submit}><Input name="name" label="Nome completo" required placeholder="Nome do cliente"/><div className="form-grid"><Input name="phone" label="WhatsApp com DDD" required placeholder="(19) 99999-9999"/><Input name="email" label="E-mail (opcional)" type="email" placeholder="cliente@email.com"/></div><label className="checkbox-row"><input type="checkbox" name="consent" defaultChecked/> O contato autorizou receber mensagens via WhatsApp</label>
 <p className="hint">Pré-selecionado para o cadastro manual. Confirme a autorização real do cliente ou desmarque a opção.</p>
 <Input name="consent_source" label="Origem do consentimento" defaultValue="Autorização confirmada pelo atendente no cadastro" placeholder="Ex.: autorização registrada na loja"/><ErrorHint error={error}/><SubmitRow onCancel={()=>setModal(false)} busy={busy} label="Cadastrar contato"/></form></Modal>}
 {selected&&<Modal title="Detalhes do contato" onClose={()=>setSelected(null)}><div className="detail-profile"><div className="detail-big-avatar">{selected.name.slice(0,1).toUpperCase()}</div><div><h3>{selected.name}</h3><p><Phone size={15}/>{selected.phone}</p>{selected.email&&<p><Mail size={15}/>{selected.email}</p>}</div></div>
 {canEdit&&<div className="form-footer">
  <Button secondary disabled={busy} onClick={()=>void changeContactStatus([selected.id],!selected.is_active)}>
   {selected.is_active?'Desativar contato':'Reativar contato'}
  </Button>
  <Button danger secondary disabled={busy} onClick={()=>void removeContacts([selected.id])}>Excluir contato</Button>
 </div>}
 <div className="detail-section"><div className="detail-heading"><h3>Mensagens WhatsApp</h3></div><p className="muted">{selected.consent&&!selected.opted_out_at?'Autorizado a receber mensagens':'Não autorizado a receber mensagens'}</p>{canEdit&&<div className="button-row"><Button secondary onClick={toggleConsent}>{selected.consent&&!selected.opted_out_at?'Revogar autorização':'Registrar autorização'}</Button><Button secondary onClick={()=>{setError('');setRulesModal(true)}}>Lembretes individuais</Button></div>}</div><div className="detail-section"><div className="detail-heading"><h3>Registros associados</h3>{canEdit&&<button className="tiny-action" onClick={()=>{setError('');setRecordModal(true)}}><Plus size={15}/> Novo</button>}</div>{records.length?records.map(x=><div className="mini-line" key={x.id}><CarFront size={17}/><span>{x.label}</span></div>):<p className="muted">Nenhum registro associado.</p>}</div>
 <div className="detail-section"><div className="detail-heading"><h3>Eventos</h3></div>{events.length?events.map(x=><div className="mini-line" key={x.id}><CalendarDays size={17}/><span>{x.title}</span><small>{fmtDate(x.starts_at)}</small></div>):<p className="muted">Nenhum evento cadastrado.</p>}</div>
 </Modal>}
 {rulesModal&&selected&&<Modal title="Lembretes do contato" onClose={()=>setRulesModal(false)}><div className="form-stack"><p className="muted">Essas preferências serão utilizadas como padrão nos eventos deste contato.</p>{contactRules.map((rule:any,i:number)=><div key={i} className="override-item"><label className="checkbox-row"><input type="checkbox" checked={rule.enabled} onChange={ev=>setContactRules(rows=>rows.map((r,j)=>j===i?{...r,enabled:ev.target.checked}:r))}/> Lembrete {i+1}</label><div className="form-grid"><label className="field"><span>Antecedência</span><input type="number" min="1" max="365" disabled={!rule.enabled} value={rule.offset_value} onChange={ev=>setContactRules(rows=>rows.map((r,j)=>j===i?{...r,offset_value:Number(ev.target.value)}:r))}/></label><label className="field"><span>Unidade</span><select disabled={!rule.enabled} value={rule.offset_unit} onChange={ev=>setContactRules(rows=>rows.map((r,j)=>j===i?{...r,offset_unit:ev.target.value}:r))}><option value="days">Dias</option><option value="weeks">Semanas</option><option value="months">Meses</option></select></label></div></div>)}<ErrorHint error={error}/><div className="form-footer"><Button secondary onClick={()=>setRulesModal(false)}>Cancelar</Button><Button disabled={busy} onClick={saveContactRules}>Salvar lembretes</Button></div></div></Modal>}
 {recordModal&&selected&&<Modal title="Novo registro associado" onClose={()=>setRecordModal(false)}><form onSubmit={addRecord} className="form-stack"><Input name="label" label="Identificação" placeholder="Ex.: Corolla / Rex / Consulta" required/>{(modelFields[segment]||[]).map(([key,label])=><Input key={key} name={key} label={label+' (opcional)'}/>)}<ErrorHint error={error}/><SubmitRow onCancel={()=>setRecordModal(false)} busy={busy}/></form></Modal>}
 </>;
}
