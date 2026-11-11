import {useState,type FormEvent,type RefObject} from 'react';
import type {Session} from '@supabase/supabase-js';
import {Bell,LockKeyhole,LogOut} from 'lucide-react';
import {callAPI} from '../api';
import {requireActiveSession} from '../auth-session';
import {supabase} from '../api';
import {Button,Card,ErrorHint} from '../components';

export function FirstPasswordChange({email,sessionRef}:{
 email:string;sessionRef:RefObject<Session|null>
}){
 const [password,setPassword]=useState('');
 const [confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');
  if(password!==confirmation){setError('As senhas não coincidem.');return}
  if(password.length<12||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)){
   setError('Informe uma senha com 12 ou mais caracteres, letras e números.');return;
  }
  setBusy(true);
  try{
   await callAPI(requireActiveSession(sessionRef),'/api/auth/initial-password','',{
    method:'POST',body:JSON.stringify({new_password:password})
   });
   // Reauthentication with the definitive password avoids stale Auth sessions.
   await supabase.auth.signOut();
  }catch(e:any){setError(e.message||'Não foi possível alterar a senha');setBusy(false)}
 }
 return <div className="auth-page">
  <div className="auth-brand"><span className="brand-square"><Bell size={23} fill="currentColor"/></span><span>BR<span className="brand-blue">Notify</span></span></div>
  <Card className="auth-card">
   <div className="auth-kicker"><LockKeyhole size={16}/> PRIMEIRO ACESSO</div>
   <h1>Defina sua senha</h1>
   <p>Este acesso foi criado com uma senha provisória. Para proteger os dados do ambiente, escolha uma senha definitiva antes de continuar.</p>
   <p className="hint">{email}</p>
   <form className="form-stack" onSubmit={submit}>
    <label className="field"><span>Nova senha</span>
     <input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password}
      onChange={e=>setPassword(e.target.value)} required/>
    </label>
    <label className="field"><span>Confirmar nova senha</span>
     <input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation}
      onChange={e=>setConfirmation(e.target.value)} required/>
    </label>
    <p className="hint">Mínimo de 12 caracteres, incluindo letras e números. Após salvar, entre novamente com a nova senha.</p>
    <ErrorHint error={error}/>
    <Button type="submit" disabled={busy}>{busy?'Atualizando...':'Salvar nova senha'}</Button>
   </form>
   <button type="button" className="text-link" onClick={()=>void supabase.auth.signOut()}><LogOut size={14}/> Sair</button>
  </Card>
  <small>BR Notify · Primeiro acesso seguro</small>
 </div>;
}
