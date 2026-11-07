import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,PageTitle,Pagination,Status,useList} from '../components';
import {fmtDate} from '../api';

type Template={id:string;name:string;language_code:string;definition:any;variable_map:Record<string,string>|null};
type Field={key:string;label:string;example:string;kind:'text'|'media'};
function fieldsOf(definition:any):Field[]{
 const fields:Field[]=[];
 for(const block of definition?.components||[]){
  if(block.type==='header'&&(block.components||[]).some((x:any)=>['image','video','document'].includes(x.type)))
   fields.push({key:'header.media',label:'Mídia do cabeçalho',example:'',kind:'media'});
  for(const [index,inner] of (block.components||[]).entries()){
   for(const param of inner.parameters||[]){
    if(!param.name)continue;
    const key=block.type==='buttons'?'buttons.'+index+'.'+param.name:block.type+'.'+param.name;
    fields.push({key,label:(block.type==='buttons'?'Botão':block.type==='body'?'Mensagem':'Cabeçalho')+' · '+param.name,example:String(param.example||''),kind:'text'});
   }
  }
 }
 return fields;
}
type Mode='choose'|'single'|'sheet'|'history';
const signalNames:Record<string,string>={
 AI_INSIGHT_PROFANITY_DETECTED:'Linguagem inadequada identificada',
 AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED:'Oportunidade de agendamento',
 AI_INSIGHT_APPOINTMENT_SET_DETECTED:'Agendamento identificado',
 AI_INSIGHT_APPOINTMENT_MISSED_DETECTED:'Oportunidade de agendamento não aproveitada',
 AI_INSIGHT_SALE_PITCH_DETECTED:'Abordagem comercial',
 AI_INSIGHT_SALE_CLOSE_DETECTED:'Possível venda concluída',
 AI_INSIGHT_SALE_PITCH_FAILED_DETECTED:'Abordagem comercial sem fechamento',
 VOICEMAIL_NEW:'Novo recado de voz',VOICEMAIL_READ:'Recado de voz ouvido',
 VOICEMAIL_DELETED:'Recado de voz excluído',
 AIR_SCHEDULING_INTERRUPTED:'Agendamento da recepcionista IA interrompido',
 AIR_SCHEDULING_ERROR:'Erro de agendamento da recepcionista IA'
};
const statuses=[['','Todos'],['queued','Na fila'],['scheduled','Programados'],['sent','Enviados'],['delivered','Entregues'],['failed','Falhas']] as const;
const choices=[
 {id:'single',title:'Enviar para uma pessoa',description:'Escolha um contato, uma mensagem e quando enviar.'},
 {id:'sheet',title:'Enviar usando uma planilha',description:'Envie mensagens para vários contatos, com horários individuais.'},
 {id:'reminders',title:'Criar lembretes de compromissos',description:'Avise clientes antes de consultas, retornos ou outros compromissos.'}
] as const;

export function Notifications({initialMode='choose'}:{initialMode?:Mode}){
 const {api,role,notify}=useApp();
 const canEdit=role==='admin';
 const [mode,setMode]=useState<Mode>(initialMode);
 const [templates,setTemplates]=useState<Template[]>([]);
 const [templateId,setTemplateId]=useState('');
 const [contactSearch,setContactSearch]=useState('');
 const [contacts,setContacts]=useState<any[]>([]);
 const [contactId,setContactId]=useState('');
 const [variables,setVariables]=useState<Record<string,string>>({});
 const [sendTime,setSendTime]=useState<'now'|'later'>('now');
 const [schedule,setSchedule]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [preview,setPreview]=useState<any>(null);
 const [result,setResult]=useState<any>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [historyTab,setHistoryTab]=useState<'messages'|'calls'|'intelligence'>('messages');
 const [historyRevision,setHistoryRevision]=useState(0);
 const history=useList('/api/notifications/history?revision='+historyRevision+(status?'&status='+status:''),mode==='history');
 const callHistory=useList('/api/goto/calls',mode==='history'&&historyTab==='calls');
 const intelligence=useList('/api/goto/events?kind=intelligence',mode==='history'&&historyTab==='intelligence');
 const template=templates.find(x=>x.id===templateId);
 const fields=useMemo(()=>fieldsOf(template?.definition),[template]);
 const textFields=fields.filter(f=>f.kind==='text');
 const mediaField=fields.some(f=>f.kind==='media');
 const mediaReady=!mediaField||!!template?.variable_map?.['header.media']?.startsWith('asset:');

 useEffect(()=>{
  let alive=true;
  api('/api/notifications/templates').then(x=>{if(alive)setTemplates(x.items||[])}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[api]);
 useEffect(()=>{
  if(mode!=='single')return;
  let alive=true;
  api('/api/contacts?q='+encodeURIComponent(contactSearch)).then(x=>{if(alive)setContacts(x.items||[])}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[api,contactSearch,mode]);

 function switchMode(next:Mode){
  setMode(next);setError('');setPreview(null);setResult(null);setBusy(false);
 }
 function chooseTemplate(id:string){setTemplateId(id);setVariables({});setPreview(null);setResult(null);setError('')}
 function sendBody(){
  return {contact_id:contactId,template_id:templateId,variables,
   ...(sendTime==='later'?{scheduled_at:schedule}:{})};
 }
 async function submitSingle(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   const sent=await api('/api/notifications/send',{method:'POST',body:JSON.stringify(sendBody())});
   notify(sent.deduplicated?'Este envio já estava na fila.':sendTime==='later'?'Mensagem programada.':'Mensagem adicionada à fila.');
   switchMode('history');setHistoryRevision(n=>n+1);
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 function downloadModel(){
  if(!template)return;
  const keys=['whatsapp','data_envio','hora_envio',...textFields.map(x=>x.key)];
  const escaped=keys.map(x=>'"'+x.replace(/"/g,'""')+'"').join(';');
  const example=['+5511999999999','','',...textFields.map(x=>/^[=+@-]/.test(x.example)?'VALOR':x.example||'VALOR')].map(x=>'"'+x.replace(/"/g,'""')+'"').join(';');
  const blob=new Blob(['\uFEFF'+escaped+'\r\n'+example+'\r\n'],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='brnotify-envios.csv';a.click();URL.revokeObjectURL(url);
 }
 async function submitSheet(checkOnly:boolean){
  if(!file||!templateId)return;
  setBusy(true);setError('');
  const data=new FormData();data.set('file',file);data.set('template_id',templateId);
  try{
   const response=await api(checkOnly?'/api/notifications/batch/preview':'/api/notifications/batch',{method:'POST',body:data});
   if(checkOnly){setPreview(response);setResult(null)}
   else{setResult(response);setPreview(null);notify(response.queued+' mensagem(ns) adicionada(s) à fila.')}
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function cancelQueued(id:string){
  if(!window.confirm('Cancelar esta mensagem programada?'))return;
  try{
   await api('/api/notifications/'+id+'/cancel',{method:'POST'});
   notify('Mensagem cancelada.');history.refresh();
  }catch(e:any){notify(e.message,'error')}
 }
 const resetSheet=(nextFile:File|null)=>{setFile(nextFile);setPreview(null);setResult(null);setError('')};
 return <div className="notify-page">
  <PageTitle eyebrow="WHATSAPP" title={mode==='choose'?'Notificações':mode==='single'?'Enviar para uma pessoa':mode==='sheet'?'Enviar por planilha':'Histórico de notificações'}
   subtitle={mode==='choose'?'Envie mensagens e lembretes com o GoTo Connect.':mode==='single'?'Uma mensagem, um contato, sem precisar criar um compromisso.':mode==='sheet'?'Prepare os envios em lote, confira os dados e programe.':'Consulte as mensagens enviadas, agendadas e com falha.'}
   action={mode!=='choose'?<Button secondary onClick={()=>switchMode('choose')}>Voltar às opções</Button>:null}/>

  {mode==='choose'&&<>
   <Card className="notify-entry">
    <h2>O que você deseja fazer?</h2>
    <p>Selecione uma opção para começar.</p>
    <div className="notify-choices">
     {choices.map(choice=>choice.id==='reminders'
      ?<Link key={choice.id} to="/events" className="notify-choice"><strong>{choice.title}</strong><span>{choice.description}</span><small>Continuar</small></Link>
      :<button type="button" key={choice.id} onClick={()=>switchMode(choice.id)} className="notify-choice" disabled={!canEdit}><strong>{choice.title}</strong><span>{choice.description}</span><small>Continuar</small></button>)}
    </div>
   </Card>
   <div className="notify-bottom-links">
    <button type="button" onClick={()=>switchMode('history')}>Ver histórico de envios</button>
    <Link to="/imports">Importar compromissos pela planilha</Link>
    <Link to="/automations">Configurar regras de lembretes</Link>
   </div>
  </>}

  {mode==='single'&&<Card className="notify-form-card">
   <form className="form-stack" onSubmit={submitSingle}>
    <div className="notify-section"><h2>1. Para quem vamos enviar?</h2>
     <label className="field"><span>Buscar contato</span><input value={contactSearch} onChange={e=>setContactSearch(e.target.value)} placeholder="Nome ou número de WhatsApp"/></label>
     <label className="field"><span>Contato</span><select required value={contactId} onChange={e=>setContactId(e.target.value)}>
      <option value="">Selecione um contato</option>
      {contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}{!c.consent||c.opted_out_at?' (sem autorização)':''}</option>)}
     </select></label>
     <p className="muted">O contato precisa ter autorização registrada para receber mensagens.</p>
    </div>
    <div className="notify-section"><h2>2. Qual mensagem vamos enviar?</h2>
     <label className="field"><span>Modelo aprovado no WhatsApp</span><select required value={templateId} onChange={e=>chooseTemplate(e.target.value)}>
      <option value="">Selecione um modelo</option>
      {templates.map(t=><option key={t.id} value={t.id}>{t.name} ({t.language_code})</option>)}
     </select></label>
     {textFields.map(f=><label className="field" key={f.key}><span>{f.label}</span><input required maxLength={1024} placeholder={f.example||'Digite o valor desta variável'} value={variables[f.key]||''} onChange={e=>setVariables(v=>({...v,[f.key]:e.target.value}))}/></label>)}
     {mediaField&&!mediaReady&&<p className="notify-alert">Este modelo precisa de uma mídia configurada em GoTo Connect antes do envio.</p>}
     {!templates.length&&<p className="notify-alert">Nenhum modelo aprovado disponível. Conecte a GoTo e sincronize os modelos em GoTo Connect.</p>}
    </div>
    <div className="notify-section"><h2>3. Quando enviar?</h2>
     <div className="notify-radio-row">
      <label><input type="radio" checked={sendTime==='now'} onChange={()=>setSendTime('now')}/> Assim que possível</label>
      <label><input type="radio" checked={sendTime==='later'} onChange={()=>setSendTime('later')}/> Escolher data e hora</label>
     </div>
     {sendTime==='later'&&<label className="field"><span>Data e hora do envio</span><input type="datetime-local" required value={schedule} onChange={e=>setSchedule(e.target.value)}/></label>}
     <p className="muted">O envio respeita o fuso horário do ambiente. A confirmação de entrega pode chegar depois.</p>
    </div>
    <ErrorHint error={error}/>
    <div className="notify-actions"><Button type="submit" disabled={busy||!mediaReady}>{busy?'Programando...':sendTime==='later'?'Programar mensagem':'Adicionar à fila'}</Button></div>
   </form>
  </Card>}

  {mode==='sheet'&&<Card className="notify-form-card">
   <div className="notify-section">
    <h2>1. Escolha a mensagem</h2>
    <label className="field"><span>Modelo aprovado no WhatsApp</span><select value={templateId} onChange={e=>chooseTemplate(e.target.value)}>
     <option value="">Selecione um modelo</option>
     {templates.map(t=><option value={t.id} key={t.id}>{t.name} ({t.language_code})</option>)}
    </select></label>
    {mediaField&&!mediaReady&&<p className="notify-alert">Configure a mídia desse modelo em GoTo Connect antes de continuar.</p>}
   </div>
   <div className="notify-section">
    <h2>2. Prepare a planilha</h2>
    <p>Use contatos já cadastrados e autorizados. Deixe data_envio e hora_envio vazios para enviar assim que possível ou preencha as duas colunas para agendar cada linha.</p>
    <div className="notify-actions"><Button secondary onClick={downloadModel} disabled={!templateId}>Baixar modelo da planilha</Button></div>
    <label className="field"><span>Arquivo CSV ou XLSX (até 250 linhas)</span><input type="file" accept=".csv,.xlsx" onChange={e=>resetSheet(e.target.files?.[0]||null)}/></label>
   </div>
   <div className="notify-section">
    <h2>3. Confira antes de programar</h2>
    <div className="notify-actions"><Button secondary disabled={!file||!templateId||!mediaReady||busy} onClick={()=>void submitSheet(true)}>{busy?'Validando...':'Verificar planilha'}</Button></div>
    {preview&&<div className="notify-preview">
     <p><strong>{preview.valid}</strong> linhas válidas de <strong>{preview.total}</strong>. {preview.invalid?preview.invalid+' com problema.':'Tudo pronto para programar.'}</p>
     {preview.errors?.map((e:any,i:number)=><p className="notify-alert" key={i}>Linha {e.row}: {e.error}</p>)}
     {preview.preview?.map((x:any)=> <p key={x.row}>Linha {x.row} · {x.phone} · {x.scheduled_at?'Agendado: '+x.scheduled_at:'Assim que possível'}</p>)}
    </div>}
    {result&&<div className="notify-preview"><strong>{result.queued} mensagens programadas.</strong>
     <p>{result.deduplicated} já estavam na fila. {result.failed} falharam durante a programação.</p>
     {result.errors?.map((e:any,i:number)=><p className="notify-alert" key={i}>Linha {e.row}: {e.error}</p>)}
     <button type="button" className="notify-text-button" onClick={()=>switchMode('history')}>Consultar histórico</button>
    </div>}
   </div>
   <ErrorHint error={error}/>
   <div className="notify-actions"><Button disabled={busy||!preview||preview.valid===0||preview.invalid>0||!mediaReady} onClick={()=>void submitSheet(false)}>{busy?'Programando...':'Confirmar programação'}</Button></div>
  </Card>}

  {mode==='history'&&<Card>
   <div className="notify-activity-tabs" role="group" aria-label="Tipo de atividade">
    <button type="button" className={'filter-chip '+(historyTab==='messages'?'filter-active':'')}
     onClick={()=>setHistoryTab('messages')}>Mensagens</button>
    <button type="button" className={'filter-chip '+(historyTab==='calls'?'filter-active':'')}
     onClick={()=>setHistoryTab('calls')}>Chamadas</button>
    <button type="button" className={'filter-chip '+(historyTab==='intelligence'?'filter-active':'')}
     onClick={()=>setHistoryTab('intelligence')}>Insights e recados</button>
   </div>
   {historyTab==='messages'?<>
    <div className="status-filters notify-filter">
     {statuses.map(([value,label])=><button type="button" key={value} className={'filter-chip '+(status===value?'filter-active':'')} onClick={()=>{setStatus(value);history.setPage(1)}}>{label}</button>)}
    </div>
    <ErrorHint error={history.error}/>
    {history.data.items.length?<div className="messages-list">{history.data.items.map((m:any)=>
     <div className="message-row" key={m.id}>
      <div className="message-content">
       <div className="message-row-top"><strong>{m.contact_name}</strong><Status value={m.status}/></div>
       <p className="muted">{m.title} · {m.phone}</p>
       <p className="text-small">Programado para {fmtDate(m.scheduled_at,true)} · {m.origin==='reminder'?'Lembrete de compromisso':m.origin==='ivr'?'Integração / URA':m.origin==='automation'?'Automação':'Envio manual'}</p>
       {m.error_description&&<p className="notify-alert">{m.error_description}</p>}
      </div>
      {canEdit&&m.origin==='panel'&&m.status==='queued'&&<Button secondary onClick={()=>void cancelQueued(m.id)}>Cancelar envio</Button>}
     </div>)}</div>:!history.loading&&<Empty title="Nenhuma mensagem neste filtro" subtitle="Os envios programados e seus resultados aparecerão aqui."/>}
    <Pagination page={history.page} pages={history.data.pages} onChange={history.setPage}/>
   </>:historyTab==='calls'?<>
    <p className="muted">Chamadas recebidas e realizadas pelo GoTo Connect. O sistema destaca ligações para revisão, sem presumir que foram perdidas.</p>
    <ErrorHint error={callHistory.error}/>
    {callHistory.data.items.length?<div className="messages-list">{callHistory.data.items.map((call:any)=>
     <div className="message-row" key={call.conversation_space_id}>
      <div className="message-content">
       <div className="message-row-top">
        <strong>{call.direction==='INBOUND'?'Chamada recebida':call.direction==='OUTBOUND'?'Chamada realizada':'Chamada telefônica'}</strong>
        <span className="status">{call.last_state==='ENDING'?'Encerrada':call.last_state==='ACTIVE'?'Em andamento':call.last_state==='STARTING'?'Iniciada':'Registrada'}</span>
       </div>
       <p className="muted">{call.summary?.external_number||'Número não identificado'} · {fmtDate(call.ended_at||call.started_at||call.updated_at,true)}</p>
       <p className="text-small">{call.report_status==='complete'?'Relatório consultado':
        call.report_status==='failed'?'Falha ao consultar o relatório':
        ['pending','retry','processing'].includes(call.report_status)?'Aguardando relatório da GoTo':'Sem relatório disponível ainda'}</p>
       {call.attention_level==='review'&&<p className="notify-alert">Revisar atendimento: o relatório não mostrou uma linha conectada. Isso não comprova que a chamada foi perdida.</p>}
       {call.attention_level==='evidence_of_answer'&&<p className="text-small">O relatório contém evidência de linha conectada.</p>}
       {(call.intelligence_signal_count||0)>0&&<p className="text-small">{call.intelligence_signal_count} sinal(is) de inteligência ou correio de voz.</p>}
       {call.sequence_gap&&<p className="notify-alert">Foram detectadas lacunas na sequência dos eventos desta chamada. A análise poderá exigir reconciliação.</p>}
      </div>
     </div>)}</div>:!callHistory.loading&&<Empty title="Nenhuma chamada registrada" subtitle="Autorize e ative o monitoramento na área GoTo Connect para receber novos eventos."/>}
    <Pagination page={callHistory.page} pages={callHistory.data.pages} onChange={callHistory.setPage}/>
    <Link to="/settings" className="notify-text-button">Configurar telefonia</Link>
   </>:<>
    <p className="muted">Sinais de IA e correio de voz informados pela GoTo após as ligações. Disponibilidade depende dos recursos da conta e da assinatura de atualizações.</p>
    <ErrorHint error={intelligence.error}/>
    {intelligence.data.items.length?<div className="messages-list">{intelligence.data.items.map((event:any)=>
     <div className="message-row" key={event.id}>
      <div className="message-content">
       <div className="message-row-top">
        <strong>{signalNames[event.metadata?.signal_code]||'Sinal de comunicação da GoTo'}</strong>
        <span className="status">{event.metadata?.signal_group==='ai'?'Insight da GoTo':event.metadata?.signal_group==='voicemail'?'Correio de voz':'Recepcionista IA'}</span>
       </div>
       <p className="muted">Registrado em {fmtDate(event.occurred_at,true)}</p>
       <p className="text-small">Ligação: {event.conversation_space_id||'Não identificada'}</p>
      </div>
     </div>)}</div>:!intelligence.loading&&<Empty title="Ainda não há insights" subtitle="Ative os insights na integração GoTo e aguarde novos relatórios de chamadas."/>}
    <Pagination page={intelligence.page} pages={intelligence.data.pages} onChange={intelligence.setPage}/>
    <Link to="/flows" className="notify-text-button">Configurar automações</Link>
   </>}
  </Card>}
 </div>;
}
