import {useEffect,useState,type FormEvent} from 'react';
import {CheckCircle2,ExternalLink,Link2,RefreshCw,Settings,Unplug,MessageSquareText,Info} from 'lucide-react';
import {useSearchParams} from 'react-router-dom';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Loader,PageTitle,Pagination,Status,SubmitRow,useList} from '../components';
const mappings=[['contact.name','Nome do contato'],['contact.phone','WhatsApp'],['contact.email','E-mail'],['event.title','Título do evento'],['event.type','Tipo do evento'],['event.date','Data do evento'],['event.time','Hora do evento'],['record.brand','Marca'],['record.model','Modelo'],['record.plate','Placa'],['record.pet_name','Nome do pet'],['record.species','Espécie'],['record.professional','Profissional'],['record.unit','Unidade'],['record.procedure','Procedimento']];
function placeholders(def:any){
 const items:string[]=[];
 for(const block of def?.components||[])for(const inside of block.components||[])for(const p of inside.parameters||[])if(!items.includes(p.name))items.push(p.name);
 return items;
}
export function SettingsPage(){
 const {api,role,notify}=useApp(),[params]=useSearchParams(),[conn,setConn]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<any>(null),[map,setMap]=useState<Record<string,string>>({});
 const list=useList('/api/templates');
 const load=()=>api('/api/goto').then(setConn).catch((e:any)=>setError(e.message));
 useEffect(()=>{load()},[api]);
 useEffect(()=>{if(params.get('goto')==='connected')notify('GoTo conectada. Configure a conta e o remetente.')},[params]);
 async function connect(){try{const r=await api('/api/goto/oauth/start');window.location.assign(r.url)}catch(e:any){notify(e.message,'error')}}
 async function saveConnection(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const values=new FormData(e.currentTarget);
  try{await api('/api/goto',{method:'PATCH',body:JSON.stringify({account_key:values.get('account_key'),from_touchpoint:values.get('from_touchpoint')})});notify('Identificadores GoTo atualizados');load()}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function subscribe(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const channelId=String(new FormData(e.currentTarget).get('channel_id')||'');
  setBusy(true);
  try{await api('/api/goto/notifications/subscribe',{method:'POST',body:JSON.stringify({channel_id:channelId})});notify('Assinatura de eventos ativada');load()}
  catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
 }
 async function sync(){setBusy(true);try{const r=await api('/api/goto/templates/sync',{method:'POST'});notify(r.count+' templates sincronizados');list.refresh()}catch(e:any){notify(e.message,'error')}finally{setBusy(false)}}
 async function saveMap(){setBusy(true);setError('');try{await api('/api/templates/'+selected.id,{method:'PATCH',body:JSON.stringify({variable_map:map})});notify('Variáveis configuradas');setSelected(null);list.refresh()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 const canEdit=role==='admin';
 return <><PageTitle eyebrow="CONFIGURAÇÕES" title="Integração GoTo" subtitle="Conecte sua conta e selecione os templates aprovados para os lembretes."/>
 <div className="settings-grid"><Card><div className="card-heading"><div><h2>Conexão GoTo Connect</h2><p>OAuth 2.0 seguro, gerenciado pelo backend.</p></div><Link2 size={22}/></div>
 {conn===null?<Loader/>:<><div className={'connection-status '+(conn.connected?'connection-on':'')}><span className="connection-indicator"/><div><strong>{conn.connected?'Conta conectada':'Nenhuma conta conectada'}</strong><p>{conn.principal||'Autorize sua conta GoTo para começar.'}</p></div></div>
 {canEdit&&<Button onClick={connect} secondary={conn.connected}><ExternalLink size={17}/>{conn.connected?'Reconectar GoTo':'Conectar conta GoTo'}</Button>}
 {conn.connected&&<form className="form-stack integration-form" onSubmit={saveConnection}><Input key={'a'+conn.account_key} name="account_key" label="Account Key da organização" required defaultValue={conn.account_key||''} placeholder="Identificador numérico"/><Input key={'f'+conn.from_touchpoint} name="from_touchpoint" label="WhatsApp Phone Number ID (Meta)" required defaultValue={conn.from_touchpoint||''} placeholder="Identificador numérico, não o telefone"/><div className="hint">O remetente WhatsApp é o ID numérico da Meta, não o telefone em formato +55.</div><ErrorHint error={error}/>{canEdit&&<Button type="submit" disabled={busy}>Salvar configuração</Button>}</form>}{conn.connected&&canEdit&&<form className="form-stack integration-form" onSubmit={subscribe}><Input key={'s'+conn.notification_channel_id} name="channel_id" label="Notification Channel ID (Webhook)" placeholder="Webhook.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" defaultValue={conn.notification_channel_id||''} required/><p className="hint">O canal deve apontar para o webhook HTTPS do BR Notify. A conta GoTo usada deve ser Super Admin da organização para criar a assinatura.</p><Button type="submit" disabled={busy}>Ativar status e descadastro</Button>{conn.notification_subscription_id&&<span className="success-line"><CheckCircle2 size={17}/> Assinatura: {conn.notification_subscription_id}</span>}</form>}
 </>}</Card>
 <Card><div className="card-heading"><div><h2>Como funciona</h2><p>Uma integração por ambiente.</p></div></div><div className="step-list"><div><span>01</span><p><strong>Conecte a GoTo</strong>Autorize o acesso usando a conta da organização.</p></div><div><span>02</span><p><strong>Identifique o remetente</strong>Informe Account Key e ID do número WhatsApp na Meta.</p></div><div><span>03</span><p><strong>Sincronize os templates</strong>Configure as variáveis antes de usar nas automações.</p></div></div><div className="notice compact"><Info size={17}/> Templates devem estar aprovados pela Meta/GoTo.</div></Card></div>
 <Card><div className="card-heading"><div><h2>Templates do WhatsApp</h2><p>Selecione um template para mapear seus parâmetros.</p></div>{canEdit&&<Button secondary onClick={sync} disabled={busy||!conn?.connected||!conn?.account_key||!conn?.from_touchpoint}><RefreshCw size={17}/> Sincronizar</Button>}</div>
 {list.data.items.length?<div className="template-grid">{list.data.items.map((t:any)=><button className={'template-card '+(selected?.id===t.id?'template-selected':'')} key={t.id} onClick={()=>{setSelected(t);setMap(t.variable_map||{});setError('')}}><div><MessageSquareText size={21}/><Status value={t.status}/></div><strong>{t.name}</strong><span>{t.language_code} · {t.category||'WhatsApp'}</span></button>)}</div>:<Empty title="Nenhum template sincronizado" subtitle="Conecte a conta GoTo e clique em sincronizar para listar seus templates."/>}
 <Pagination page={list.page} pages={list.data.pages} onChange={list.setPage}/></Card>
 {selected&&<Card className="mapping-card"><div className="card-heading"><div><div className="eyebrow">MAPEAMENTO</div><h2>{selected.name}</h2><p>Associe cada parâmetro aos dados cadastrados no BR Notify.</p></div><button className="text-link" onClick={()=>setSelected(null)}>Fechar</button></div>
 {placeholders(selected.definition).length?placeholders(selected.definition).map(name=><div className="mapping-row" key={name}><code>{name}</code><select disabled={!canEdit} value={map[name]||''} onChange={e=>setMap(m=>({...m,[name]:e.target.value}))}><option value="">Escolha um campo</option>{mappings.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>):<div className="success-line"><CheckCircle2 size={18}/> Template sem variáveis para mapear.</div>}
 <ErrorHint error={error}/>{canEdit&&<Button onClick={saveMap} disabled={busy}>Salvar variáveis</Button>}</Card>}
 </>;
}
