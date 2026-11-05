import {useEffect,useState,type FormEvent} from 'react';
import {
 Activity,AlertCircle,ArrowUpRight,BookOpen,Check,Clipboard,Code2,
 KeyRound,Link2,Plus,RefreshCw,RotateCcw,ShieldCheck,Trash2,
 Webhook,MessagesSquare
} from 'lucide-react';
import {useApp} from '../context';
import {
 Button,Card,Empty,ErrorHint,Modal,PageTitle,Pagination,Status,formValues,useList
} from '../components';
import {API_URL,fmtDate} from '../api';

type Tab='keys'|'webhooks'|'deliveries'|'logs'|'inbound';
const SCOPES=[
 ['contacts:read','Consultar contatos'],
 ['contacts:write','Cadastrar e atualizar contatos'],
 ['events:read','Consultar agendamentos'],
 ['events:write','Criar, reagendar e cancelar eventos'],
 ['imports:write','Importar lotes de até 50 eventos'],
 ['messages:read','Consultar status dos disparos'],
 ['messages:send','Enviar templates por HTTP (URA/CRM)']
] as const;
const EVENTS=[
 'reminder.sent','reminder.delivered','reminder.failed',
 'event.cancelled','appointment.confirmed',
 'appointment.reschedule_requested','appointment.declined'
] as const;
const LABELS:Record<string,string>={
 'reminder.sent':'Mensagem enviada',
 'reminder.delivered':'Mensagem entregue',
 'reminder.failed':'Falha de disparo',
 'event.cancelled':'Agendamento cancelado',
 'appointment.confirmed':'Agendamento confirmado',
 'appointment.reschedule_requested':'Solicitação de reagendamento',
 'appointment.declined':'Agendamento recusado'
};
const choices:{id:Tab;label:string;icon:any}[]=[
 {id:'keys',label:'Chaves de API',icon:KeyRound},
 {id:'webhooks',label:'Webhooks',icon:Webhook},
 {id:'deliveries',label:'Entregas',icon:Activity},
 {id:'logs',label:'Logs de API',icon:Code2},
 {id:'inbound',label:'Confirmações',icon:MessagesSquare}
];

function SecretModal({
 label,secret,onClose
}:{label:string;secret:string;onClose:()=>void}){
 const [copied,setCopied]=useState(false);
 const copy=async()=>{try{await navigator.clipboard.writeText(secret);setCopied(true)}catch{setCopied(false)}};
 return <Modal title="Credencial criada" onClose={onClose}>
  <div className="form-stack">
   <div className="integration-warning"><ShieldCheck size={19}/><span>Copie a credencial agora. Por segurança, ela não poderá ser consultada novamente.</span></div>
   <div className="secret-preview"><strong>{label}</strong><code>{secret}</code></div>
   <div className="button-row"><Button onClick={copy}>{copied?<Check size={17}/>:<Clipboard size={17}/>} {copied?'Copiado':'Copiar segredo'}</Button><Button secondary onClick={onClose}>Concluir</Button></div>
  </div>
 </Modal>;
}

export function ApiIntegrations(){
 const {api,notify,role}=useApp();
 const [tab,setTab]=useState<Tab>('keys');
 const [create,setCreate]=useState<'key'|'webhook'|null>(null);
 const [secret,setSecret]=useState<{label:string;token:string}|null>(null);
 const [scopes,setScopes]=useState<string[]>(['contacts:read','contacts:write','events:read','events:write']);
 const [events,setEvents]=useState<string[]>(['reminder.sent','reminder.delivered','reminder.failed']);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [health,setHealth]=useState<any>(null);
 useEffect(()=>{let alive=true;api('/api/integrations/health').then(result=>{if(alive)setHealth(result)}).catch(()=>{});return()=>{alive=false}},[api]);
 const keys=useList('/api/integrations/keys',tab==='keys');
 const hooks=useList('/api/integrations/webhooks',tab==='webhooks');
 const deliveries=useList('/api/integrations/deliveries',tab==='deliveries');
 const logs=useList('/api/integrations/logs',tab==='logs');
 const inbound=useList('/api/integrations/inbound',tab==='inbound');
 const loadingError=tab==='keys'?keys.error:tab==='webhooks'?hooks.error:tab==='deliveries'?deliveries.error:tab==='logs'?logs.error:inbound.error;
 const docsLink=API_URL+'/v1/openapi.json';
 const toggle=(value:string,selected:string[],setter:(values:string[])=>void)=>{
  setter(selected.includes(value)?selected.filter(v=>v!==value):[...selected,value]);
 };
 const act=async(callback:()=>Promise<any>,onSuccess:string)=>{
  setBusy(true);setError('');
  try{await callback();notify(onSuccess)}catch(e:any){setError(e.message);notify(e.message,'error')}
  finally{setBusy(false)}
 };
 async function createKey(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!scopes.length){setError('Selecione ao menos uma permissão');return}
  const v=formValues(e);setBusy(true);setError('');
  try{
   const result=await api('/api/integrations/keys',{method:'POST',body:JSON.stringify({
    label:v.label,scopes,expires_in_days:Number(v.expires_in_days||90)
   })});
   setCreate(null);keys.refresh();setSecret({label:v.label,token:result.token});notify('Chave criada');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function createWebhook(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!events.length){setError('Selecione ao menos um evento');return}
  const v=formValues(e);setBusy(true);setError('');
  try{
   const result=await api('/api/integrations/webhooks',{method:'POST',body:JSON.stringify({
    label:v.label,url:v.url,event_types:events
   })});
   setCreate(null);hooks.refresh();setSecret({label:v.label,token:result.signing_secret});notify('Webhook cadastrado');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <>
  <PageTitle eyebrow="PLATAFORMA / INTEGRAÇÕES" title="API e Integrações"
   subtitle="Conecte ERPs e CRMs, acompanhe chamadas e sincronize seus agendamentos."
   action={<a href={docsLink} target="_blank" rel="noopener noreferrer" className="nd-primary-button"><BookOpen size={17}/> Documentação <ArrowUpRight size={15}/></a>}/>
  <div className="integration-explainer">
   <span className="integration-explainer-icon"><Link2 size={20}/></span>
   <div><strong>Sua operação, conectada.</strong><span>Chaves limitadas ao ambiente atual. Dados externos chegam pela API; eventos e status são devolvidos por webhooks assinados.</span></div>
  </div>
  {health?.alerts?.length>0&&<section className="integration-health" aria-label="Saúde das integrações">
    <div className="integration-health-head"><AlertCircle size={17}/><strong>Verificações operacionais</strong><span>{health.alerts.length} aviso(s)</span></div>
    <div className="integration-health-list">{health.alerts.map((alert:any)=><div key={alert.code} className={'integration-health-item integration-health-'+alert.severity}>{alert.message}</div>)}</div>
   </section>}
  <div className="integration-tablist" role="tablist" aria-label="Seções de integração">
   {choices.map(option=>{
    const Icon=option.icon;
    return <button type="button" key={option.id} role="tab" aria-selected={tab===option.id}
      className={'integration-tab '+(tab===option.id?'integration-tab-active':'')}
      onClick={()=>setTab(option.id)}><Icon size={17}/>{option.label}</button>;
   })}
  </div>
  {loadingError&&<ErrorHint error={loadingError}/>}
  {tab==='keys'&&<Card>
   <div className="card-heading"><div><h2>Credenciais de integração</h2><p>Crie uma chave por sistema e limite suas permissões.</p></div><Button onClick={()=>{setError('');setCreate('key')}}><Plus size={16}/> Nova chave</Button></div>
   {keys.data.items.length?<div className="data-list">{keys.data.items.map((key:any)=><div className="data-row static-row" key={key.id}>
    <span className="event-icon"><KeyRound size={19}/></span>
    <span className="row-main"><strong>{key.label}</strong><small><code>{key.token_prefix}••••••</code> · {key.scopes.length} permissões · último uso {key.last_used_at?fmtDate(key.last_used_at,true):'nunca'}</small></span>
    <span className="integration-meta"><small>Expira {fmtDate(key.expires_at)}</small>{key.revoked_at?<span className="status status-failed">Revogada</span>:new Date(key.expires_at)<new Date()?<span className="status status-paused">Expirada</span>:<span className="status status-active">Ativa</span>}</span>
    {!key.revoked_at&&<button title="Revogar chave" className="icon-button" disabled={busy} onClick={()=>{
     if(window.confirm('Revogar esta chave imediatamente?'))void act(async()=>{
      await api('/api/integrations/keys/'+key.id,{method:'DELETE'});keys.refresh();
     },'Chave revogada');
    }}><Trash2 size={17}/></button>}
   </div>)}</div>:<Empty title="Nenhuma chave criada" subtitle="Crie uma credencial para integrar o primeiro sistema externo."/>}
   <Pagination page={keys.page} pages={keys.data.pages} onChange={keys.setPage}/>
  </Card>}
  {tab==='webhooks'&&<Card>
   <div className="card-heading"><div><h2>Webhooks de retorno</h2><p>Avise seu CRM sobre entregas, erros e confirmações.</p></div><Button onClick={()=>{setError('');setCreate('webhook')}}><Plus size={16}/> Novo webhook</Button></div>
   {hooks.data.items.length?<div className="data-list">{hooks.data.items.map((hook:any)=><div className="data-row static-row integration-webhook-row" key={hook.id}>
    <span className="event-icon"><Webhook size={19}/></span>
    <span className="row-main"><strong>{hook.label}</strong><small className="integration-url">{hook.destination_url}</small><small>{hook.event_types.map((event:string)=>LABELS[event]||event).join(' · ')}</small></span>
    <span className={'status '+(hook.active?'status-active':'status-paused')}>{hook.active?'Ativo':'Pausado'}</span>
    <div className="integration-inline-actions">
     <button className="icon-button" title={hook.active?'Pausar':'Ativar'} disabled={busy}
      onClick={()=>void act(async()=>{
       await api('/api/integrations/webhooks/'+hook.id,{method:'PATCH',body:JSON.stringify({active:!hook.active})});hooks.refresh();
      },'Webhook atualizado')}><RefreshCw size={16}/></button>
     <button className="icon-button" title="Rotacionar segredo" disabled={busy}
      onClick={()=>{
       if(window.confirm('O segredo anterior deixará de funcionar. Rotacionar?'))void act(async()=>{
        const result=await api('/api/integrations/webhooks/'+hook.id+'/rotate',{method:'POST'});
        setSecret({label:hook.label,token:result.signing_secret});
       },'Novo segredo criado');
      }}><KeyRound size={16}/></button>
     <button className="icon-button" title="Excluir webhook" disabled={busy}
      onClick={()=>{
       if(window.confirm('Excluir este webhook e seu histórico de entregas?'))void act(async()=>{
        await api('/api/integrations/webhooks/'+hook.id,{method:'DELETE'});hooks.refresh();
       },'Webhook excluído');
      }}><Trash2 size={16}/></button>
    </div>
   </div>)}</div>:<Empty title="Nenhum webhook cadastrado" subtitle="Cadastre uma URL HTTPS pública para receber eventos assinados."/>}
   <Pagination page={hooks.page} pages={hooks.data.pages} onChange={hooks.setPage}/>
  </Card>}
  {tab==='deliveries'&&<Card>
   <div className="card-heading"><div><h2>Entregas de webhooks</h2><p>Reenvios são controlados e apresentam a resposta HTTP.</p></div><span className="integration-muted">20 por página</span></div>
   {deliveries.data.items.length?<div className="data-list">{deliveries.data.items.map((row:any)=><div className="data-row static-row" key={row.id}>
    <span className="event-icon"><Activity size={18}/></span>
    <span className="row-main"><strong>{LABELS[row.event_type]||row.event_type}</strong><small>{row.endpoint_label} · {fmtDate(row.created_at,true)} · {row.attempts} tentativas</small>{row.last_error&&<small className="integration-error">{row.last_error}</small>}</span>
    <span className={'status '+(row.status==='delivered'?'status-active':row.status==='dead'?'status-failed':'status-scheduled')}>{({delivered:'Entregue',dead:'Falhou',queued:'Na fila',processing:'Processando'} as Record<string,string>)[row.status]||row.status}</span>
    {row.status==='dead'&&<button className="icon-button" title="Reprocessar" disabled={busy} onClick={()=>void act(async()=>{
     await api('/api/integrations/deliveries/'+row.id+'/retry',{method:'POST'});deliveries.refresh();
    },'Entrega recolocada na fila')}><RotateCcw size={17}/></button>}
   </div>)}</div>:<Empty title="Nenhuma entrega" subtitle="Quando um evento disparar um webhook, seu histórico aparecerá aqui."/>}
   <Pagination page={deliveries.page} pages={deliveries.data.pages} onChange={deliveries.setPage}/>
  </Card>}
  {tab==='logs'&&<Card>
   <div className="card-heading"><div><h2>Requisições externas</h2><p>Endpoint, status e duração — sem armazenar tokens ou corpos das requisições.</p></div><span className="integration-muted">20 por página</span></div>
   {logs.data.items.length?<div className="data-list">{logs.data.items.map((row:any)=><div className="data-row static-row" key={row.id}>
    <span className="integration-method">{row.method}</span><span className="row-main"><strong>{row.route}</strong><small>{row.key_label||'Chave removida'} · {fmtDate(row.created_at,true)}</small></span>
    <span className="integration-response">{row.duration_ms} ms</span><span className={'status '+(row.status_code>=400?'status-failed':'status-active')}>{row.status_code}</span>
   </div>)}</div>:<Empty title="Nenhuma chamada registrada" subtitle="O histórico aparecerá quando alguma integração utilizar a API."/>}
   <Pagination page={logs.page} pages={logs.data.pages} onChange={logs.setPage}/>
  </Card>}
  {tab==='inbound'&&<Card>
   <div className="card-heading"><div><h2>Confirmações do WhatsApp</h2><p>Respostas recebidas, solicitações de reagendamento e casos ambíguos.</p></div><span className="integration-muted">20 por página</span></div>
   {inbound.data.items.length?<div className="data-list">{inbound.data.items.map((row:any)=><div className="data-row static-row" key={row.id}>
    <span className="event-icon"><MessagesSquare size={18}/></span>
    <span className="row-main"><strong>{row.contact_name||'Contato não identificado'}</strong><small>{row.event_title||'Sem associação'} · {fmtDate(row.received_at,true)}</small></span>
    <span className="integration-meta"><span className={'status '+(row.resolution==='matched'?'status-active':'status-failed')}>{row.resolution==='matched'?'Associado':row.resolution==='ambiguous'?'Ambíguo':'Não associado'}</span><small>{({confirmed:'Confirmado',reschedule_requested:'Reagendamento',declined:'Recusado'} as Record<string,string>)[row.decision]||row.decision}</small></span>
   </div>)}</div>:<Empty title="Sem respostas registradas" subtitle="As confirmações serão registradas após habilitar o webhook de entrada da GoTo."/>}
   <Pagination page={inbound.page} pages={inbound.data.pages} onChange={inbound.setPage}/>
  </Card>}
  {create==='key'&&<Modal title="Criar chave de API" onClose={()=>setCreate(null)}>
   <form className="form-stack" onSubmit={createKey}>
    <label className="field"><span>Nome da integração</span><input name="label" required minLength={2} maxLength={80} placeholder="Ex.: CRM da concessionária"/></label>
    <label className="field"><span>Prazo da chave</span><select name="expires_in_days" defaultValue="90"><option value="30">30 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">365 dias</option></select></label>
    <div className="integration-choices-label">Permissões concedidas</div>
    <div className="integration-choices">{SCOPES.map(([value,label])=><label key={value} className="integration-choice"><input type="checkbox" checked={scopes.includes(value)} onChange={()=>toggle(value,scopes,setScopes)}/><span><strong>{label}</strong><code>{value}</code></span></label>)}</div>
    <ErrorHint error={error}/>
    <div className="form-footer"><Button secondary onClick={()=>setCreate(null)}>Cancelar</Button><Button type="submit" disabled={busy}>Criar chave</Button></div>
   </form>
  </Modal>}
  {create==='webhook'&&<Modal title="Cadastrar webhook" onClose={()=>setCreate(null)}>
   <form className="form-stack" onSubmit={createWebhook}>
    <label className="field"><span>Nome da integração</span><input name="label" required minLength={2} maxLength={80} placeholder="Ex.: Webhook do ERP"/></label>
    <label className="field"><span>URL HTTPS de destino</span><input name="url" type="url" pattern="https://.*" required placeholder="https://crm.exemplo.com/brnotify/webhook"/></label>
    <div className="integration-choices-label">Eventos que serão enviados</div>
    <div className="integration-choices">{EVENTS.map(value=><label key={value} className="integration-choice"><input type="checkbox" checked={events.includes(value)} onChange={()=>toggle(value,events,setEvents)}/><span><strong>{LABELS[value]}</strong><code>{value}</code></span></label>)}</div>
    <p className="hint">O servidor de destino deverá validar os cabeçalhos HMAC e deduplicar o identificador do evento. Somente endereços HTTPS públicos na porta 443 são aceitos.</p>
    <ErrorHint error={error}/>
    <div className="form-footer"><Button secondary onClick={()=>setCreate(null)}>Cancelar</Button><Button type="submit" disabled={busy}>Cadastrar webhook</Button></div>
   </form>
  </Modal>}
  {secret&&<SecretModal label={secret.label} secret={secret.token} onClose={()=>setSecret(null)}/>}
 </>;
}
