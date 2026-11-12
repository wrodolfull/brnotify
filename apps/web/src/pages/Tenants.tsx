import {useState,type FormEvent} from 'react';
import {Building2,Plus,Power,Store,Stethoscope,PawPrint,CarFront,Trash2} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Loader,Modal,NewButton,PageTitle,Pagination,Status,SubmitRow,formValues,useList} from '../components';
import {fmtDate,typeLabel} from '../api';
export function Tenants(){
 const {api,notify,refresh,selectTenant}=useApp();
 const list=useList('/api/tenants');
 const [modal,setModal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [segment,setSegment]=useState('automotive');
 const icons:Record<string,any>={automotive:CarFront,clinic:Stethoscope,pet:PawPrint,custom:Store};
 async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const form=formValues(e);
  try{await api('/api/tenants',{method:'POST',body:JSON.stringify({name:form.name,segment,timezone:'America/Sao_Paulo'})});notify('Ambiente criado');setModal(false);list.refresh();await refresh()}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function toggle(t:any){const status=t.status==='active'?'paused':'active';if(!window.confirm('Alterar o estado deste ambiente para '+status+'?'))return;try{await api('/api/tenants/'+t.id,{method:'PATCH',body:JSON.stringify({status})});notify('Ambiente atualizado');list.refresh();await refresh()}catch(e:any){notify(e.message,'error')}}
 async function remove(t:any){
  if(busy)return;
  const typed=window.prompt(
   'EXCLUSÃO PERMANENTE de "'+t.name+'". Todos os contatos, compromissos, automações, históricos e credenciais deste ambiente serão apagados. Digite o nome EXATO da empresa para confirmar:'
  );
  if(typed===null)return;
  if(typed!==t.name){notify('Nome diferente. O ambiente não foi excluído.','error');return}
  setBusy(true);setError('');
  try{
   await api('/api/tenants/'+t.id,{method:'DELETE',body:JSON.stringify({confirm_name:typed})});
   notify('Ambiente excluído permanentemente.');
   if(list.data.items.length===1&&list.page>1)list.setPage(list.page-1);
   else list.refresh();
   await refresh();
  }catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
 }
 return <><PageTitle eyebrow="PLATAFORMA / SUPER ADMIN" title="Ambientes" subtitle="Crie e monitore todos os ambientes da plataforma, sem planos ou cobrança." action={<NewButton onClick={()=>setModal(true)} label="Novo ambiente"/>}/>
 <Card><div className="card-heading"><h2>Empresas cadastradas</h2><span className="toolbar-count">{list.data.total} ambientes</span></div><ErrorHint error={list.error}/>
 {list.data.items.length?<div className="data-list">{list.data.items.map((t:any)=>{const Icon=icons[t.segment]||Building2;return <div className="data-row static-row" key={t.id}><span className="event-icon"><Icon size={20}/></span><span className="row-main"><strong>{t.name}</strong><small>{typeLabel[t.segment]||t.segment} · criado em {fmtDate(t.created_at)}</small></span><Status value={t.status}/><Button secondary onClick={()=>selectTenant(t.id)}>Acessar</Button><button className="icon-button" disabled={busy} title={t.status==='active'?'Pausar':'Ativar'} onClick={()=>toggle(t)}><Power size={18}/></button>
 <button className="icon-button" disabled={busy} title={'Excluir '+t.name} aria-label={'Excluir '+t.name} onClick={()=>void remove(t)}><Trash2 size={18}/></button></div>})}</div>:list.loading?<Loader/>:<Empty title="Nenhum ambiente criado" subtitle="Crie o primeiro ambiente e escolha um segmento inicial."/>}<Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/></Card>
 {modal&&<Modal title="Novo ambiente" onClose={()=>setModal(false)}><form className="form-stack" onSubmit={create}><Input label="Nome da empresa" name="name" placeholder="Ex.: Concessionária Central" required/><div className="field"><span>Segmento</span><div className="segment-picker">{[['automotive','Automotivo'],['clinic','Clínica'],['pet','Pet shop'],['custom','Personalizado']].map(([id,label])=>{const Icon=icons[id];return <button type="button" key={id} className={'segment-item '+(segment===id?'segment-selected':'')} onClick={()=>setSegment(id)}><Icon size={23}/><span>{label}</span></button>})}</div></div><p className="hint">O segmento define campos e modelos de importação; os três lembretes padrão serão criados automaticamente.</p><ErrorHint error={error}/><SubmitRow busy={busy} label="Criar ambiente" onCancel={()=>setModal(false)}/></form></Modal>}
 </>;
}
