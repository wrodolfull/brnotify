import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent,type RefObject} from 'react';
import type {Session} from '@supabase/supabase-js';
import {NavLink,Navigate,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {Bell,Building2,ChevronDown,LayoutDashboard,Clock3,LogOut,Menu,Send,Settings,Shield,Users,X,LockKeyhole,PlugZap,ChartNoAxesCombined} from 'lucide-react';
import {supabase,callAPI,type Actor} from './api';
import {preserveAuthenticatedView,requireActiveSession} from './auth-session';
import {AppContext} from './context';
import {Button,Card,ErrorHint,Input,Loader} from './components';
import {Dashboard} from './pages/Dashboard';
import {Contacts} from './pages/Contacts';
import {Events} from './pages/Events';
import {Imports} from './pages/Imports';
import {Automations} from './pages/Automations';
import {WorkflowAutomations} from './pages/WorkflowAutomations';
import {Messages} from './pages/Messages';
import {Notifications} from './pages/Notifications';
import {SettingsPage} from './pages/Settings';
import {TemplateLibrary} from './pages/TemplateLibrary';
import {ApiIntegrations} from './pages/ApiIntegrations';
import {Reports} from './pages/Reports';
import {Tenants} from './pages/Tenants';
import {Members} from './pages/Members';
import {FirstPasswordChange} from './pages/FirstPasswordChange';
function AuthScreen(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[help,setHelp]=useState(false);
 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   const {error}=await supabase.auth.signInWithPassword({email,password});
   if(error)throw error;
  }catch(e:any){setError(e.message||'Não foi possível entrar')}finally{setBusy(false)}
 }
 return <div className="auth-page">
  <div className="auth-brand"><span className="brand-square"><Bell size={23} fill="currentColor"/></span><span>BR<span className="brand-blue">Notify</span></span></div>
  <Card className="auth-card"><div className="auth-kicker"><LockKeyhole size={16}/> Acesso restrito</div>
   <h1>{help?'Recuperar acesso':'Bem-vindo de volta'}</h1>
   {help?<p>Como o BR Notify não utiliza envio de convites por e-mail, solicite ao Super Admin uma nova senha provisória em <strong>Acessos → Redefinir senha</strong>. Ela deverá ser trocada no primeiro login.</p>:
   <>
    <p>Gerencie lembretes e notificações em um só lugar. O acesso é concedido pelo administrador da plataforma.</p>
    <form onSubmit={submit} className="form-stack">
     <label className="field"><span>E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required placeholder="seu@email.com"/></label>
     <label className="field"><span>Senha</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>
     <ErrorHint error={error}/>
     <Button type="submit" disabled={busy}>{busy?'Verificando...':'Entrar na plataforma'}</Button>
    </form>
   </>}
   <button className="text-link" onClick={()=>{setHelp(!help);setError('')}}>{help?'Voltar ao login':'Esqueci minha senha'}</button>
  </Card><small>BR Notify · Ambiente seguro</small>
 </div>;
}
function MenuItem({to,icon:Icon,label,onClose}:{to:string;icon:any;label:string;onClose:()=>void}){return <NavLink to={to} end={to==='/'} onClick={onClose} className={({isActive})=>'nav-item '+(isActive?'nav-active':'')}><Icon size={19} strokeWidth={1.8}/><span>{label}</span></NavLink>}
function Workspace({sessionRef}:{sessionRef:RefObject<Session|null>}){
 const [actor,setActor]=useState<Actor|null>(null),[tenants,setTenants]=useState<any[]>([]),[tenantId,setTenantId]=useState(localStorage.getItem('brnotify.tenant')||''),[busy,setBusy]=useState(true),[fatal,setFatal]=useState(''),[menuOpen,setMenuOpen]=useState(false);
 const tenantIdRef=useRef(tenantId);
 const [toast,setToast]=useState<{message:string;kind:'success'|'error'}|null>(null);
 const location=useLocation(),navigate=useNavigate();
 // Use the newest token from the ref without changing the API function identity
 // when Supabase emits SIGNED_IN on focus or TOKEN_REFRESHED.
 const api=useCallback((path:string,options:RequestInit={},forceTenant?:string)=>
  callAPI(requireActiveSession(sessionRef),path,forceTenant??tenantId,options),
  [sessionRef,tenantId]
 );
 const refresh=useCallback(async()=>{
  const current=requireActiveSession(sessionRef);
  const [me,list]=await Promise.all([
   callAPI(current,'/api/me',''),
   callAPI(current,'/api/tenant-options','')
  ]);
  const items=[...(list.items||[])];
  const saved=tenantIdRef.current||localStorage.getItem('brnotify.tenant')||'';
  const authorized=items.some((x:any)=>(x.id||x.tenant_id)===saved);
  // A different signed-in user cannot inherit the previous user's workspace.
  const nextId=authorized?saved:(items[0]?.id||items[0]?.tenant_id||'');
  setActor(me);setTenants(items);
  tenantIdRef.current=nextId;
  setTenantId(old=>old===nextId?old:nextId);
  if(nextId)localStorage.setItem('brnotify.tenant',nextId);
  else localStorage.removeItem('brnotify.tenant');
 },[sessionRef]);
 useEffect(()=>{
  let alive=true;
  setBusy(true);
  refresh().then(()=>{if(alive)setFatal('')}).catch(e=>{if(alive)setFatal(e.message)}).finally(()=>{if(alive)setBusy(false)});
  return()=>{alive=false};
 },[refresh]);
 useEffect(()=>{setMenuOpen(false)},[location.pathname]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),4500);return()=>clearTimeout(t)},[toast]);
 const notify=useCallback((message:string,kind:'success'|'error'='success')=>setToast({message,kind}),[]);
 const selected=tenants.find(t=>(t.id||t.tenant_id)===tenantId);
 const tenantName=selected?.name||'Selecionar ambiente';
 const segment=selected?.segment||actor?.memberships.find(m=>m.tenant_id===tenantId)?.segment||'custom';
 const isSuper=!!actor?.superAdmin;
 const role=isSuper?'admin':(selected?.role||actor?.memberships.find(m=>m.tenant_id===tenantId)?.role||'viewer');
 const changeTenant=useCallback((id:string)=>{tenantIdRef.current=id;setTenantId(id);localStorage.setItem('brnotify.tenant',id);navigate('/');setMenuOpen(false)},[navigate]);
 const ctx=useMemo(()=>actor?{actor,tenantId,tenantName,segment,role:role as 'admin'|'viewer',isSuper,api,selectTenant:changeTenant,notify,refresh}:null,[actor,tenantId,tenantName,segment,role,isSuper,api,changeTenant,notify,refresh]);
 if(busy)return <Loader/>;
 if(fatal)return <div className="error-full"><h2>Acesso indisponível</h2><p>{fatal}</p><Button onClick={()=>supabase.auth.signOut()}>Sair</Button></div>;
 if(!ctx)return null;
 if(actor?.mustChangePassword)return <FirstPasswordChange email={actor.email} sessionRef={sessionRef}/>;
 const close=()=>setMenuOpen(false);
 return <AppContext.Provider value={ctx}>
  <div className="layout">
   {menuOpen&&<button className="mobile-scrim" aria-label="Fechar menu" onClick={close}/>}
   <aside className={'sidebar '+(menuOpen?'sidebar-open':'')}>
    <div className="sidebar-top"><div className="sidebar-logo"><div className="logo-icon"><Bell size={20} fill="currentColor"/></div><strong>BR<span>Notify</span></strong></div><button className="sidebar-close" onClick={close} aria-label="Fechar"><X size={20}/></button></div>
    <div className="sidebar-workspace"><span className="sidebar-caption">AMBIENTE ATUAL</span><label className="workspace-select"><Building2 size={18}/><select aria-label="Ambiente atual" value={tenantId} onChange={e=>changeTenant(e.target.value)}><option value="">Selecione um ambiente</option>{tenants.map(t=><option key={t.id||t.tenant_id} value={t.id||t.tenant_id}>{t.name}</option>)}</select><ChevronDown size={14}/></label></div>
    <nav className="side-nav"><span className="sidebar-caption">PRINCIPAL</span>
     <MenuItem to="/" icon={LayoutDashboard} label="Visão geral" onClose={close}/>
     <MenuItem to="/notifications" icon={Send} label="Notificações" onClose={close}/>
     <MenuItem to="/flows" icon={Clock3} label="Automações" onClose={close}/>
     <MenuItem to="/contacts" icon={Users} label="Contatos" onClose={close}/>
     <MenuItem to="/activities" icon={ChartNoAxesCombined} label="Atividades" onClose={close}/>
     <MenuItem to="/reports" icon={ChartNoAxesCombined} label="Relatórios" onClose={close}/>
     <span className="sidebar-caption nav-section">GERENCIAMENTO</span>
     <MenuItem to="/settings" icon={Settings} label="GoTo Connect" onClose={close}/>
     {role==='admin'&&<MenuItem to="/api-integrations" icon={PlugZap} label="API e Integrações" onClose={close}/> }
     {isSuper&&<><MenuItem to="/tenants" icon={Building2} label="Ambientes" onClose={close}/><MenuItem to="/members" icon={Shield} label="Acessos" onClose={close}/></>}
    </nav>
    <div className="sidebar-bottom"><div className="account-circle">{(actor?.email||'').slice(0,1).toUpperCase()}</div><div className="sidebar-account"><strong>{(actor?.email||'').split('@')[0]}</strong><span>{isSuper?'Super Admin':role==='viewer'?'Visualizador':'Administrador'}</span></div><button title="Sair" className="logout" onClick={()=>supabase.auth.signOut()}><LogOut size={19}/></button></div>
   </aside>
   <div className="main-shell"><header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={()=>setMenuOpen(true)}><Menu size={23}/></button><div className="topbar-breadcrumb"><span>BR Notify</span><span className="divider-dot">/</span><strong>{tenantName}</strong></div><div className="topbar-right"><span className="topbar-env">{isSuper?'Super Admin':role==='viewer'?'Visualização':'Admin'}</span><div className="topbar-avatar">{(actor?.email||'').slice(0,1).toUpperCase()}</div></div></header>
    <main className="page-content">{!tenantId&&location.pathname!=='/tenants'?<div className="empty-workspace"><Building2 size={34}/><h2>Nenhum ambiente selecionado</h2><p>Crie ou selecione um ambiente para começar.</p>{isSuper&&<Button onClick={()=>navigate('/tenants')}>Gerenciar ambientes</Button>}</div>:
     <Routes><Route path="/" element={<Dashboard/>}/><Route path="/notifications" element={<Notifications/>}/><Route path="/activities" element={<Notifications initialMode="history"/>}/><Route path="/contacts" element={<Contacts/>}/><Route path="/events" element={<Events/>}/><Route path="/imports" element={<Imports/>}/><Route path="/flows" element={<WorkflowAutomations/>}/><Route path="/automations" element={<Automations/>}/><Route path="/messages" element={<Messages/>}/><Route path="/reports" element={<Reports/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/template-library" element={<TemplateLibrary/>}/><Route path="/api-integrations" element={role==='admin'?<ApiIntegrations/>:<Navigate to="/"/>}/><Route path="/tenants" element={isSuper?<Tenants/>:<Navigate to="/"/>}/><Route path="/members" element={isSuper?<Members/>:<Navigate to="/"/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes>}</main>
   </div>
   {toast&&<div role="status" className={'toast toast-'+toast.kind}>{toast.message}<button onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>
 </AppContext.Provider>;
}
export function App(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[recovery,setRecovery]=useState(false),[newPassword,setNewPassword]=useState(''),[error,setError]=useState('');
 const sessionRef=useRef<Session|null>(null);
 useEffect(()=>{
  let alive=true;
  // INITIAL_SESSION resolves startup; focus and JWT refresh must not remount
  // Workspace or refetch all tabs. Only a change of user identity does that.
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
   if(!alive)return;
   sessionRef.current=next;
   setSession(current=>preserveAuthenticatedView(current,next));
   setLoading(false);
   if(event==='PASSWORD_RECOVERY')setRecovery(true);
   if(event==='SIGNED_OUT')setRecovery(false);
  });
  return()=>{alive=false;subscription.unsubscribe()};
 },[]);
 if(loading)return <Loader/>;
 if(recovery&&session)return <div className="auth-page"><Card className="auth-card"><h1>Definir nova senha</h1><form className="form-stack" onSubmit={async e=>{e.preventDefault();const {error}=await supabase.auth.updateUser({password:newPassword});if(error)setError(error.message);else setRecovery(false)}}><label className="field"><span>Nova senha</span><input type="password" value={newPassword} minLength={12} onChange={e=>setNewPassword(e.target.value)} required/></label><ErrorHint error={error}/><Button type="submit">Atualizar senha</Button></form></Card></div>;
 return session?<Workspace key={session.user.id} sessionRef={sessionRef}/>:<AuthScreen/>;
}
