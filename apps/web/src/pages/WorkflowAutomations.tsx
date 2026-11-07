import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,PageTitle,Pagination,useList} from '../components';
import {fmtDate} from '../api';

type Trigger='message.received'|'message.delivery.updated'|'call.ended'|'call.report.ready';
type Action='internal'|'webhook'|'whatsapp';
type Form={
 title:string;trigger_type:Trigger;match_mode:'any'|'equals'|'contains';match_text:string;
 delay_minutes:number;check_no_new_message:boolean;
 action_type:Action;action_label:string;endpoint_id:string|null;template_id:string|null;
 template_variables:Record<string,string>
};
const blank:Form={title:'',trigger_type:'message.received',match_mode:'any',match_text:'',
 delay_minutes:0,check_no_new_message:false,action_type:'internal',action_label:'Avisar a equipe',
 endpoint_id:null,template_id:null,template_variables:{}};
const triggers=[
 {value:'message.received',label:'Receber uma resposta no WhatsApp'},
 {value:'message.delivery.updated',label:'Receber um status de entrega'},
 {value:'call.ended',label:'Uma chamada ser encerrada'},
 {value:'call.report.ready',label:'O relatório de uma chamada ficar disponível'}
] as const;
const actions=[
 {value:'internal',label:'Registrar um aviso no BR Notify'},
 {value:'webhook',label:'Avisar outro sistema por webhook'},
 {value:'whatsapp',label:'Enviar template pelo WhatsApp'}
] as const;
const examples=[
 {title:'Resposta recebida',description:'Registrar uma resposta específica do WhatsApp.',trigger:'message.received',action:'internal',mode:'equals',text:'2'},
 {title:'Acompanhar chamadas',description:'Registrar quando uma chamada terminar.',trigger:'call.report.ready',action:'internal',mode:'any',text:''},
 {title:'Informar meu sistema',description:'Acionar um webhook após uma resposta de WhatsApp.',trigger:'message.received',action:'webhook',mode:'any',text:''}
] as const;

function fieldsFor(template:any):Array<{key:string;example:string}>{
 const values:Array<{key:string;example:string}>=[];
 for(const block of template?.definition?.components||[]){
  for(const [i,inner] of (block.components||[]).entries()){
   for(const param of inner.parameters||[]){
    if(typeof param.name!=='string')continue;
    values.push({key:block.type==='buttons'?'buttons.'+i+'.'+param.name:block.type+'.'+param.name,example:String(param.example||'')});
   }
  }
 }
 return values;
}
const fromSaved=(f:any):Form=>({
 title:f.title||'',trigger_type:f.trigger_type,match_mode:f.match_mode||'any',
 match_text:f.match_text||'',delay_minutes:f.delay_minutes||0,
 check_no_new_message:!!f.check_no_new_message,action_type:f.action_type,
 action_label:f.action_label||'Avisar a equipe',endpoint_id:f.endpoint_id||null,
 template_id:f.template_id||null,template_variables:f.template_variables||{}
});

export function WorkflowAutomations(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const [view,setView]=useState<'list'|'edit'|'runs'>('list');
 const [selected,setSelected]=useState<any>(null);
 const [form,setForm]=useState<Form>({...blank});
 const [options,setOptions]=useState<{templates:any[];endpoints:any[]}>({templates:[],endpoints:[]});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const flows=useList('/api/automation-flows');
 const runs=useList('/api/automation-runs');
 useEffect(()=>{let alive=true;api('/api/automation-options').then(r=>{if(alive)setOptions(r)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[api]);
 const template=options.templates.find(x=>x.id===form.template_id);
 const templateFields=useMemo(()=>fieldsFor(template),[template]);
 const isWhatsapp=form.trigger_type==='message.received';
 const update=<K extends keyof Form>(key:K,value:Form[K])=>setForm(v=>({...v,[key]:value}));
 function edit(flow?:any){
  setSelected(flow||null);
  setForm(flow?fromSaved(flow):{...blank,template_variables:{}});
  setError('');setView('edit');
 }
 function useExample(example:typeof examples[number]){
  setSelected(null);
  setForm({...blank,title:example.title,trigger_type:example.trigger as Trigger,
   action_type:example.action as Action,match_mode:example.mode,match_text:example.text,
   action_label:example.action==='webhook'?'Notificar sistema externo':'Avisar a equipe'});
  setError('');setView('edit');
 }
 async function save(e:FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try{
   const body={...form,match_text:form.match_mode==='any'?null:form.match_text,
    endpoint_id:form.action_type==='webhook'?form.endpoint_id:null,
    template_id:form.action_type==='whatsapp'?form.template_id:null,
    template_variables:form.action_type==='whatsapp'?form.template_variables:{}};
   const updated=await api(selected?'/api/automation-flows/'+selected.id:'/api/automation-flows',
    {method:selected?'PUT':'POST',body:JSON.stringify(body)});
   notify(selected?'Automação atualizada.':'Automação criada como rascunho.');
   flows.refresh();setSelected(updated);setView('list');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function changeStatus(flow:any){
  setBusy(true);setError('');
  try{
   const status=flow.status==='active'?'paused':'active';
   await api('/api/automation-flows/'+flow.id+'/status',{method:'POST',body:JSON.stringify({status})});
   notify(status==='active'?'Automação ativada. Apenas novos eventos serão considerados.':'Automação pausada. Execuções ainda pendentes foram canceladas.');
   flows.refresh();runs.refresh();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 function triggerSelect(t:Trigger){
  setForm(v=>({...v,trigger_type:t,match_mode:t==='message.received'?v.match_mode:'any',
   match_text:t==='message.received'?v.match_text:'',
   check_no_new_message:t==='message.received'?v.check_no_new_message:false,
   action_type:t==='message.received'?v.action_type:v.action_type==='whatsapp'?'internal':v.action_type,
   template_id:t==='message.received'?v.template_id:null,
   template_variables:t==='message.received'?v.template_variables:{}}));
 }
 return <div className="wf-page">
  <PageTitle eyebrow="COMUNICAÇÃO" title={view==='edit'?(selected?'Editar automação':'Criar automação'):view==='runs'?'Execuções':'Automações'}
   subtitle={view==='edit'?'Defina quando agir, o que verificar e o que deverá acontecer.':view==='runs'?'Acompanhe o que aconteceu em cada execução.':'Transforme mensagens e chamadas da GoTo em ações automáticas.'}
   action={view==='list'&&canEdit?<Button onClick={()=>edit()}>Criar automação</Button>:view!=='list'?<Button secondary onClick={()=>{setView('list');setError('')}}>Voltar</Button>:null}/>
  <ErrorHint error={error}/>
  {view==='list'&&<>
   {!flows.data.items.length&&<Card>
    <h2>Comece por um exemplo</h2>
    <p className="muted">Escolha um ponto de partida. Você poderá revisar todos os detalhes antes de ativar.</p>
    <div className="wf-example-grid">{examples.map(x=><button key={x.title} type="button" disabled={!canEdit} className="wf-example"
     onClick={()=>useExample(x)}><strong>{x.title}</strong><span>{x.description}</span><small>Configurar</small></button>)}</div>
   </Card>}
   <Card>
    <div className="wf-list-header"><h2>Suas automações</h2><button className="wf-link" onClick={()=>{runs.refresh();setView('runs')}}>Ver execuções</button></div>
    {flows.data.items.length?<div className="wf-list">{flows.data.items.map((f:any)=><div key={f.id} className="wf-list-item">
     <div className="wf-list-main">
      <div className="wf-title-line"><strong>{f.title}</strong><span className={'wf-status wf-'+f.status}>{f.status==='active'?'Ativa':f.status==='paused'?'Pausada':'Rascunho'}</span></div>
      <p>{triggers.find(x=>x.value===f.trigger_type)?.label||f.trigger_type} · {actions.find(x=>x.value===f.action_type)?.label||f.action_type}</p>
      {f.last_error&&<p className="notify-alert">{f.last_error}</p>}
      <small>{f.recent_runs||0} execuções nos últimos 7 dias</small>
     </div>
     <div className="wf-item-actions">
      {canEdit&&<Button secondary disabled={busy||f.status==='active'} onClick={()=>edit(f)}>Editar</Button>}
      {canEdit&&<Button disabled={busy} secondary={f.status==='active'} onClick={()=>void changeStatus(f)}>{f.status==='active'?'Pausar':'Ativar'}</Button>}
     </div>
    </div>)}</div>:<Empty title="Nenhuma automação criada" subtitle="Crie uma regra simples a partir de um exemplo ou configure a sua."/>}
    <Pagination page={flows.page} pages={flows.data.pages} onChange={flows.setPage}/>
   </Card>
   <p className="wf-footnote">As regras antigas de lembretes continuam separadas. <Link to="/automations">Configurar lembretes de compromissos</Link>.</p>
  </>}

  {view==='edit'&&<form className="wf-editor" onSubmit={save}>
   <Card>
    <label className="field"><span>Nome da automação</span><input required minLength={3} maxLength={120} value={form.title} onChange={e=>update('title',e.target.value)} placeholder="Ex.: Avisar quando cliente pedir reagendamento"/></label>
   </Card>
   <div className="wf-flow">
    <section className="wf-step">
     <div className="wf-step-heading"><span className="wf-step-number">1</span><div><h2>Quando acontecer...</h2><p>Escolha qual acontecimento inicia a automação.</p></div></div>
     <label className="field"><span>Acontecimento</span><select value={form.trigger_type} onChange={e=>triggerSelect(e.target.value as Trigger)}>
      {triggers.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}
     </select></label>
     {isWhatsapp&&<>
      <label className="field"><span>Qual resposta deve iniciar?</span><select value={form.match_mode} onChange={e=>update('match_mode',e.target.value as Form['match_mode'])}>
       <option value="any">Qualquer resposta</option><option value="equals">Resposta igual a</option><option value="contains">Resposta contém</option>
      </select></label>
      {form.match_mode!=='any'&&<label className="field"><span>Texto da resposta</span><input required maxLength={200} value={form.match_text} onChange={e=>update('match_text',e.target.value)} placeholder="Ex.: REAGENDAR ou 2"/></label>}
     </>}
     {form.trigger_type==='message.delivery.updated'&&<>
      <label className="field"><span>Qual resultado?</span><select value={form.match_mode} onChange={e=>setForm(v=>({...v,match_mode:e.target.value as Form['match_mode'],match_text:e.target.value==='any'?'':v.match_text||'FAILED'}))}>
       <option value="any">Qualquer mudança de entrega</option>
       <option value="equals">Um status específico</option>
      </select></label>
      {form.match_mode==='equals'&&<label className="field"><span>Status da entrega</span><select value={form.match_text||'FAILED'} onChange={e=>update('match_text',e.target.value)}>
       <option value="FAILED">Falhou</option><option value="DELIVERED">Entregue</option><option value="SENT">Enviado</option>
      </select></label>}
      <p className="wf-hint">Somente mensagens WhatsApp identificadas nos envios do BR Notify podem iniciar este fluxo.</p>
     </>}
     {form.trigger_type.startsWith('call.')&&<p className="wf-hint">Uma chamada encerrada não significa necessariamente chamada perdida. Nesta etapa, o fluxo só pode registrar avisos ou avisar sistemas externos.</p>}
     
    </section>
    <div className="wf-connector"><span/></div>
    <section className="wf-step">
     <div className="wf-step-heading"><span className="wf-step-number">2</span><div><h2>Aguardar...</h2><p>Escolha quanto tempo esperar antes de agir.</p></div></div>
     <div className="wf-inline"><label className="field"><span>Tempo de espera em minutos</span><input type="number" required min={0} max={10080} value={form.delay_minutes} onChange={e=>setForm(v=>({...v,delay_minutes:Number(e.target.value),check_no_new_message:Number(e.target.value)>0?v.check_no_new_message:false}))}/></label>
      <p>Use 0 para agir assim que possível. Para 24 horas, informe 1440.</p></div>
    </section>
    <div className="wf-connector"><span/></div>
    <section className="wf-step">
     <div className="wf-step-heading"><span className="wf-step-number">3</span><div><h2>Antes de agir, verificar...</h2><p>Evite executar ações desnecessárias.</p></div></div>
     {isWhatsapp&&form.delay_minutes>0?<label className="wf-check"><input type="checkbox" checked={form.check_no_new_message} onChange={e=>update('check_no_new_message',e.target.checked)}/>
      <span>Executar somente se este número não tiver enviado outra mensagem depois da primeira.</span></label>:
      <p className="wf-hint">Nenhuma verificação adicional. O fluxo continuará após a espera, desde que ainda esteja ativo.</p>}
    </section>
    <div className="wf-connector"><span/></div>
    <section className="wf-step">
     <div className="wf-step-heading"><span className="wf-step-number">4</span><div><h2>Então fazer...</h2><p>Defina a ação que o BR Notify deverá executar.</p></div></div>
     <label className="field"><span>Ação</span><select value={form.action_type}
      onChange={e=>setForm(v=>({...v,action_type:e.target.value as Action,endpoint_id:null,template_id:null,template_variables:{}}))}>
      {actions.filter(a=>a.value!=='whatsapp'||isWhatsapp).map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
     </select></label>
     {form.action_type==='internal'&&<label className="field"><span>Texto do aviso</span><input required maxLength={180} value={form.action_label} onChange={e=>update('action_label',e.target.value)} placeholder="Ex.: Cliente solicitou retorno"/></label>}
     {form.action_type==='webhook'&&<>
      <label className="field"><span>Sistema que será avisado</span><select required value={form.endpoint_id||''} onChange={e=>update('endpoint_id',e.target.value||null)}>
       <option value="">Selecione um webhook</option>{options.endpoints.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
      </select></label>
      <p className="wf-hint">O evento será enviado ao endpoint cadastrado, com assinatura de segurança. <Link to="/api-integrations">Gerenciar webhooks</Link>.</p>
     </>}
     {form.action_type==='whatsapp'&&<>
      <label className="field"><span>Template aprovado da GoTo</span><select required value={form.template_id||''} onChange={e=>setForm(v=>({...v,template_id:e.target.value||null,template_variables:{}}))}>
       <option value="">Selecione um template</option>{options.templates.map(x=><option key={x.id} value={x.id}>{x.name} ({x.language_code})</option>)}
      </select></label>
      {templateFields.map(field=><label className="field" key={field.key}><span>{field.key}</span>
       <input required maxLength={1024} value={form.template_variables[field.key]||''}
        onChange={e=>update('template_variables',{...form.template_variables,[field.key]:e.target.value})}
        placeholder={field.example||'Valor desta variável'}/></label>)}
      {!!templateFields.length&&<p className="wf-hint">Use um texto fixo ou uma variável: <code>{'{{contact.name}}'}</code>, <code>{'{{contact.phone}}'}</code> ou <code>{'{{message.text}}'}</code>.</p>}
      <p className="wf-hint">Só envia para contatos cadastrados, com consentimento ativo e template aprovado. A mensagem entra na fila de envios da GoTo.</p>
     </>}
    </section>
   </div>
   <ErrorHint error={error}/>
   <div className="wf-actions"><Button secondary onClick={()=>setView('list')}>Cancelar</Button>
    <Button type="submit" disabled={busy||!canEdit||selected?.status==='active'}>{busy?'Salvando...':selected?'Salvar alterações':'Salvar como rascunho'}</Button>
   </div>
  </form>}

  {view==='runs'&&<Card>
   {runs.data.items.length?<div className="wf-list">{runs.data.items.map((r:any)=><div key={r.id} className="wf-list-item">
    <div className="wf-list-main">
     <div className="wf-title-line"><strong>{r.flow_title}</strong><span className={'wf-status wf-run-'+r.status}>{({
      completed:'Concluída',pending:'Aguardando',processing:'Executando',skipped:'Ignorada',
      failed:'Falha',unknown:'Indeterminada',cancelled:'Cancelada'
     } as Record<string,string>)[r.status]||r.status}</span></div>
     <p>{triggers.find(x=>x.value===r.event_type)?.label||r.event_type} · {fmtDate(r.created_at,true)}</p>
     {r.result?.kind==='webhook'&&<small>Webhook colocado na fila de entrega.</small>}
     {r.result?.kind==='whatsapp'&&<small>WhatsApp colocado na fila de envio.</small>}
     {r.result?.kind==='internal'&&<small>{r.result.label}</small>}
     {r.reason&&<p className="notify-alert">{r.reason}</p>}
    </div>
   </div>)}</div>:<Empty title="Ainda não há execuções" subtitle="Quando uma automação ativa identificar um novo evento, o histórico aparecerá aqui."/>}
   <ErrorHint error={runs.error}/>
   <Pagination page={runs.page} pages={runs.data.pages} onChange={runs.setPage}/>
  </Card>}
 </div>;
}
