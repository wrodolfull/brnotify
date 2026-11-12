import {useState,type FormEvent} from 'react';
import {Copy,KeyRound,Trash2} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Loader,Modal,NewButton,PageTitle,Pagination,SubmitRow,formValues,useList} from '../components';

type Credentials={email:string;temporary_password:string|null;created?:boolean};
export function Members(){
 const {api,notify,tenantName}=useApp(),list=useList('/api/members');
 const [modal,setModal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [credentials,setCredentials]=useState<Credentials|null>(null);
 function close(){
  if(busy)return;
  setModal(false);setCredentials(null);setError('');
 }
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const v=formValues(e);
  try{
   const result=await api('/api/members',{method:'POST',body:JSON.stringify({
    name:v.name,email:v.email,role:v.role,
    allow_existing_membership:v.allow_existing_membership==='on'
   })});
   setCredentials(result);list.refresh();
   notify(result.created?'Usuário criado com senha provisória.':'Conta existente vinculada a '+tenantName+'.');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function reset(userId:string,email:string){
  if(!window.confirm('Redefinir a senha de '+email+'? A senha anterior deixará de funcionar e a troca será obrigatória.'))return;
  setBusy(true);setError('');
  try{
   const result=await api('/api/members/'+userId+'/reset-password',{method:'POST'});
   setCredentials({...result,created:true});setModal(true);
   notify('Senha provisória gerada. Copie-a antes de fechar.');
  }catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
 }
 async function copy(){
  if(!credentials?.temporary_password)return;
  try{
   await navigator.clipboard.writeText(
    'BR Notify: https://painel.bridgesolucoes.com.br\nE-mail: '+credentials.email+
    '\nSenha provisória: '+credentials.temporary_password+
    '\nTroque a senha no primeiro acesso.'
   );
   notify('Credenciais copiadas. Compartilhe por um canal seguro.');
  }catch{setError('Não foi possível copiar automaticamente. Selecione a senha e copie manualmente.')}
 }
 async function remove(id:string){
  if(!window.confirm('Remover o acesso deste usuário ao ambiente?'))return;
  try{await api('/api/members/'+id,{method:'DELETE'});notify('Acesso removido');list.refresh()}
  catch(e:any){notify(e.message,'error')}
 }
 return <>
  <PageTitle eyebrow="PLATAFORMA / SUPER ADMIN" title="Acessos"
   subtitle={'Gerencie os usuários de '+tenantName+'.'}
   action={<NewButton label="Novo usuário" onClick={()=>{setModal(true);setError('');setCredentials(null)}}/>}/>
  <Card><div className="card-heading"><div><h2>Usuários do ambiente</h2>
   <p>Crie contas sem SMTP, defina permissões ou redefina senhas provisórias.</p></div></div>
   <ErrorHint error={list.error}/>
   {list.data.items.length?<div className="data-list">
    {list.data.items.map((u:any)=><div className="data-row static-row" key={u.user_id}>
     <span className="list-avatar">{u.email.slice(0,1).toUpperCase()}</span>
     <span className="row-main"><strong>{u.email}</strong><small>{u.role==='admin'?'Administrador':'Visualizador'}</small></span>
     <span className="status">{u.role==='admin'?'Admin':'Leitura'}</span>
     <button className="icon-button" disabled={busy} onClick={()=>void reset(u.user_id,u.email)}
      title="Gerar nova senha provisória" aria-label={'Redefinir senha de '+u.email}><KeyRound size={17}/></button>
     <button className="icon-button" disabled={busy} onClick={()=>void remove(u.user_id)}
      title="Remover usuário" aria-label={'Remover '+u.email}><Trash2 size={17}/></button>
    </div>)}
   </div>:list.loading?<Loader/>:<Empty title="Sem usuários adicionais" subtitle="Crie um usuário para acessar este ambiente."/>}
   <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/>
  </Card>
  {modal&&<Modal title={credentials?'Acesso provisionado':'Novo usuário'} onClose={close}>
   {credentials?<div className="form-stack">
    <p>{credentials.temporary_password
     ?'Copie e compartilhe estas credenciais por um canal seguro. A senha só aparece agora e deverá ser trocada no primeiro acesso.'
     :'A conta existente recebeu acesso a '+tenantName+'. O usuário mantém a senha atual e poderá trocar de ambiente pelo seletor, quando tiver mais de um vínculo.'}</p>
    <label className="field"><span>E-mail</span><input readOnly value={credentials.email}/></label>
    {credentials.temporary_password&&<>
     <label className="field"><span>Senha provisória</span><input readOnly value={credentials.temporary_password}
      onFocus={e=>e.currentTarget.select()}/></label>
     <Button secondary onClick={()=>void copy()}><Copy size={17}/> Copiar dados de acesso</Button>
    </>}
    <ErrorHint error={error}/>
    <div className="form-footer"><Button onClick={close}>Concluir</Button></div>
   </div>
   :<form className="form-stack" onSubmit={create}>
    <div className="hint"><strong>Ambiente de destino: {tenantName}</strong></div>
    <Input name="name" label="Nome completo" placeholder="Nome do usuário" required/>
    <Input name="email" type="email" label="E-mail" placeholder="pessoa@empresa.com.br" required/>
    <label className="field"><span>Permissão neste ambiente</span><select name="role">
     <option value="admin">Administrador — gerencia dados e integrações</option>
     <option value="viewer">Visualizador — somente leitura</option>
    </select></label>
    <label className="hint" style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
     <input type="checkbox" name="allow_existing_membership" style={{marginTop:3,flexShrink:0}}/>
     <span>Se o e-mail já tiver acesso a outra empresa, autorizo conceder acesso também a <strong>{tenantName}</strong>, sem remover os vínculos anteriores.</span>
    </label>
    <p className="hint">Usuários novos recebem senha provisória sem SMTP. Contas existentes mantêm a senha atual; as permissões são independentes por empresa. Contas Super Admin não podem ser vinculadas como usuários comuns.</p>
    <ErrorHint error={error}/>
    <SubmitRow busy={busy} label="Criar acesso" onCancel={close}/>
   </form>}
  </Modal>}
 </>;
}
