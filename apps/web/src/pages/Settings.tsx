import {useEffect,useState,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,Input,Loader,PageTitle,Pagination,Status,useList} from '../components';

const fixedFields:[string,string][]=[
 ['contact.name','Nome do contato'],['contact.phone','WhatsApp'],['contact.email','E-mail'],
 ['event.title','Título do evento'],['event.type','Tipo do evento'],['event.date','Data do evento'],
 ['event.time','Horário'],['record.brand','Marca'],['record.model','Modelo'],
 ['record.plate','Placa'],['record.pet_name','Nome do pet'],['record.species','Espécie'],
 ['record.professional','Profissional'],['record.unit','Unidade'],['record.procedure','Procedimento']
];
type Field={key:string;name:string;label:string;example:string;kind:'text'|'button'|'media';mediaType?:string};
function templateFields(definition:any):Field[]{
 const result:Field[]=[];
 for(const block of definition?.components||[]){
  if(block.type==='header'){
   for(const inner of block.components||[]){
    if(['image','video','document'].includes(inner.type))
     result.push({key:'header.media',name:'header.media',label:'Cabeçalho de '+({image:'imagem',video:'vídeo',document:'documento'} as Record<string,string>)[inner.type],example:'',kind:'media',mediaType:inner.type});
   }
  }
  for(const [index,inner] of (block.components||[]).entries()){
   for(const p of inner.parameters||[]){
    if(!p.name)continue;
    result.push({
     key:block.type==='buttons'?'buttons.'+index+'.'+p.name:block.type+'.'+p.name,
     name:p.name,
     label:(block.type==='buttons'?'Botão '+(index+1):block.type==='header'?'Cabeçalho':block.type==='body'?'Mensagem':'Rodapé')+' · '+p.name,
     example:String(p.example||''),kind:block.type==='buttons'?'button':'text'
    });
   }
  }
 }
 return result;
}
function previewText(component:any){
 return (component?.components||[]).map((inner:any)=>String(inner.attributes?.text||'')).filter(Boolean).join('\n');
}
function isMatchingMedia(mime:string,kind:string){
 return kind==='image'?mime.startsWith('image/'):kind==='video'?mime.startsWith('video/'):mime==='application/pdf';
}
function MapField({field,value,assets,onChange,disabled}:{
 field:Field;value:string;assets:any[];onChange:(v:string)=>void;disabled:boolean
}){
 const current=value||'';
 const fixed=fixedFields.some(([key])=>key===current);
 const asset=current.startsWith('asset:');
 const literal=current.startsWith('literal:');
 const custom=!asset&&!literal&&!!current&&!fixed;
 const selectedValue=literal?'literal:':custom?'__custom__':current;
 return <div className="goto-map-field">
  <div className="goto-map-label"><strong>{field.label}</strong><small>{field.kind==='media'?'Biblioteca privada ou ID dinâmico do registro':field.kind==='button'?'Parâmetro do botão do WhatsApp':'Variável do template'}</small></div>
  <div className="goto-map-controls">
   <select aria-label={'Origem de '+field.label} disabled={disabled} value={selectedValue} onChange={e=>{
    const v=e.target.value;
    onChange(v==='literal:'?'literal:':v==='__custom__'?'record.':v);
   }}>
    <option value="">Selecione a origem</option>
    {field.kind==='media'?<>
     {assets.filter(a=>isMatchingMedia(a.content_type,field.mediaType||'')).map(a=><option key={a.id} value={'asset:'+a.id}>{a.label} · {a.content_type}</option>)}
     {asset&&!assets.some(a=>'asset:'+a.id===current)&&<option value={current}>Arquivo selecionado (outra página)</option>}
     <option value="record.media_asset_id">Registro → ID da mídia</option>
     <option value="event.custom.media_asset_id">Evento → ID da mídia</option>
     <option value="contact.custom.media_asset_id">Contato → ID da mídia</option>
     <option value="__custom__">Outro campo dinâmico...</option>
    </>:<>
     {fixedFields.map(([key,label])=><option key={key} value={key}>{label}</option>)}
     <option value="literal:">Texto fixo</option>
     <option value="__custom__">Campo personalizado...</option>
    </>}
   </select>
   {literal&&<input aria-label={'Valor fixo de '+field.label} placeholder="Digite o valor fixo" disabled={disabled} value={current.slice(8)} maxLength={190} onChange={e=>onChange('literal:'+e.target.value)}/>}
   {custom&&<input aria-label={'Campo de '+field.label} placeholder="record.campo ou event.custom.campo" disabled={disabled} value={current} maxLength={200} onChange={e=>onChange(e.target.value)}/>}
  </div>
 </div>;
}
export function SettingsPage(){
 const {api,role,notify}=useApp();
 const [params]=useSearchParams();
 const templates=useList('/api/templates');
 const media=useList('/api/goto/media');
 const testHistory=useList('/api/goto/templates/tests',role==='admin');
 const [conn,setConn]=useState<any>(null);
 const [callMonitor,setCallMonitor]=useState<any>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [selected,setSelected]=useState<any>(null);
 const [mapping,setMapping]=useState<Record<string,string>>({});
 const [testPhone,setTestPhone]=useState('');
 const [testValues,setTestValues]=useState<Record<string,string>>({});
 const [testAsset,setTestAsset]=useState('');
 const [testConsent,setTestConsent]=useState(false);
 const [testResult,setTestResult]=useState('');
 const canEdit=role==='admin';
 const fields=selected?templateFields(selected.definition):[];
 const load=()=>api('/api/goto').then(setConn).catch((e:any)=>setError(e.message));
 const loadCalls=()=>api('/api/goto/calls/status').then(setCallMonitor).catch((e:any)=>setError(e.message));
 useEffect(()=>{void load();void loadCalls()},[api]);
 useEffect(()=>{if(params.get('goto')==='connected')notify('GoTo conectada. Configure a conta e o remetente.')},[params]);
 async function connect(withCalls=false){
  try{
   const result=await api('/api/goto/oauth/start'+(withCalls?'?calls=true':''));
   window.location.assign(result.url);
  }catch(e:any){notify(e.message,'error')}
 }
 async function activateCalls(){
  setBusy(true);setError('');
  try{
   await api('/api/goto/calls/activate',{method:'POST'});
   notify('Monitoramento de chamadas ativado.');
   await loadCalls();
  }catch(e:any){setError(e.message);await loadCalls()}
  finally{setBusy(false)}
 }
 async function activateIntelligence(){
  setBusy(true);setError('');
  try{
   await api('/api/goto/calls/intelligence/activate',{method:'POST'});
   notify('Insights e eventos de correio de voz habilitados.');
   await loadCalls();
  }catch(e:any){setError(e.message);await loadCalls()}
  finally{setBusy(false)}
 }
 async function disconnect(){
  if(!canEdit||busy||!conn?.connected)return;
  const confirmed=window.confirm(
   'Desconectar esta conta GoTo deste ambiente? Os lembretes e envios WhatsApp na fila serão cancelados, as automações serão pausadas e os tokens serão removidos do BR Notify. Esta ação não revoga automaticamente a autorização no portal GoTo. Deseja continuar?'
  );
  if(!confirmed)return;
  setBusy(true);setError('');
  try{
   const result=await api('/api/goto',{method:'DELETE'});
   await Promise.all([load(),loadCalls()]);
   setSelected(null);setTestResult('');templates.refresh();testHistory.refresh();
   notify('Conexão GoTo removida do BR Notify. '+result.cancelled_reminders+' lembretes e '+result.cancelled_direct+' envios na fila cancelados.');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function saveConnection(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const values=new FormData(e.currentTarget);
  try{
   await api('/api/goto',{method:'PATCH',body:JSON.stringify({
    account_key:values.get('account_key'),from_touchpoint:values.get('from_touchpoint')
   })});
   notify('Configuração GoTo atualizada');await load();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function subscribe(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const id=String(new FormData(e.currentTarget).get('channel_id')||'');
  try{
   await api('/api/goto/notifications/subscribe',{method:'POST',body:JSON.stringify({channel_id:id})});
   notify('Assinatura de eventos ativada');await load();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function sync(){
  setBusy(true);setError('');
  try{
   const data=await api('/api/goto/templates/sync',{method:'POST'});
   notify(data.count+' templates sincronizados');templates.refresh();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 function chooseTemplate(t:any){
  setSelected(t);setMapping(t.variable_map||{});setError('');setTestResult('');
  const inputs=templateFields(t.definition).filter(f=>f.kind!=='media');
  setTestValues(Object.fromEntries(inputs.map(f=>[f.key,f.example])));
  setTestConsent(false);setTestAsset('');
 }
 async function saveMapping(){
  if(!selected)return;
  setBusy(true);setError('');
  try{
   await api('/api/templates/'+selected.id,{method:'PATCH',body:JSON.stringify({variable_map:mapping})});
   setSelected({...selected,variable_map:mapping});
   templates.refresh();notify('Mapeamento de texto, mídia e botões salvo');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function uploadMedia(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const data=new FormData(e.currentTarget);
  const el=e.currentTarget;
  try{
   await api('/api/goto/media',{method:'POST',body:data});
   el.reset();media.setPage(1);media.refresh();notify('Arquivo privado enviado com sucesso');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function deleteMedia(id:string){
  if(!window.confirm('Excluir esta mídia? Templates que dependem dela precisarão ser atualizados.'))return;
  setBusy(true);setError('');
  try{
   await api('/api/goto/media/'+id,{method:'DELETE'});
   media.refresh();notify('Mídia excluída');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function testSend(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selected||!testConsent)return;
  setBusy(true);setError('');setTestResult('');
  try{
   const result=await api('/api/goto/templates/'+selected.id+'/test',{
    method:'POST',body:JSON.stringify({
     phone:testPhone,consent_confirmed:true,test_values:testValues,
     ...(testAsset?{media_asset_id:testAsset}:{})
    })
   });
   setTestResult('Mensagem aceita pela GoTo (entrega ainda não confirmada). ID: '+result.message_id);
   testHistory.refresh();
   notify('Envio de teste aceito pela GoTo');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 const sections=(selected?.definition?.components||[]) as any[];
 return <div className="goto-rich-page">
  <PageTitle eyebrow="CONFIGURAÇÕES" title="Integração GoTo"
   subtitle="Envie lembretes com texto, mídia e botões aprovados no WhatsApp."/>
  <div className="settings-grid">
   <Card>
    <div className="card-heading"><div><h2>Conexão GoTo Connect</h2><p>OAuth por ambiente, com renovação automática de token.</p></div></div>
    {conn===null?<Loader/>:<>
     <div className={'connection-status '+(conn.connected?'connection-on':'')}>
      <span className="connection-indicator"/><div><strong>{conn.connected?'Conta conectada':'Nenhuma conta conectada'}</strong>
      <p>{conn.principal||'Autorize sua organização para começar.'}</p></div>
     </div>
     {canEdit&&<div className="goto-connection-actions">
      <Button onClick={()=>void connect(false)} disabled={busy} secondary>{conn.connected?'Reconectar GoTo':'Conectar conta GoTo'}</Button>
      {conn.connected&&<Button danger secondary disabled={busy} onClick={()=>void disconnect()}>Desconectar GoTo</Button>}
     </div>}
     {conn.connected&&canEdit&&<p className="hint">Desconectar remove as credenciais GoTo deste ambiente, pausa automações e cancela envios pendentes. Para revogar também a autorização no provedor, remova o acesso diretamente na sua conta GoTo.</p>}
     {conn.connected&&<form className="form-stack integration-form" onSubmit={saveConnection}>
      <Input name="account_key" label="Account Key" required defaultValue={conn.account_key||''} key={'a'+conn.account_key}/>
      <Input name="from_touchpoint" label="ID do número WhatsApp na Meta" required defaultValue={conn.from_touchpoint||''} key={'f'+conn.from_touchpoint}/>
      {canEdit&&<Button type="submit" disabled={busy}>Salvar integração</Button>}
     </form>}
     {conn.connected&&canEdit&&<form className="form-stack integration-form" onSubmit={subscribe}>
      <Input name="channel_id" label="Notification Channel ID" placeholder="Webhook.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required defaultValue={conn.notification_channel_id||''}/>
      <p className="hint">O canal webhook deve apontar para o backend HTTPS do BR Notify e a conta deve ter autorização para criar a assinatura.</p>
      <Button type="submit" disabled={busy}>Ativar notificações</Button>
      {conn.notification_subscription_id&&<p className="success-line">Assinatura: {conn.notification_subscription_id}</p>}
     </form>}
    </>}
   </Card>
   <Card>
    <div className="card-heading"><div><h2>Formatos disponíveis</h2><p>Somente templates já aprovados pela Meta e disponíveis na GoTo.</p></div></div>
    <div className="goto-capabilities">
     <div><strong>Texto</strong><span>Variáveis nomeadas em cabeçalho, mensagem e rodapé.</span></div>
     <div><strong>Imagem</strong><span>JPEG, PNG ou WebP no cabeçalho do template.</span></div>
     <div><strong>Vídeo</strong><span>MP4 cadastrado na biblioteca do ambiente.</span></div>
     <div><strong>Documento</strong><span>PDF em mídia privada.</span></div>
     <div><strong>Botões</strong><span>Respostas rápidas estáticas e URLs com parâmetros dinâmicos.</span></div>
    </div>
    <p className="hint">Os arquivos são enviados como anexo multipart. Os botões e textos precisam existir previamente na definição do template aprovado.</p>
   </Card>
  </div>

  <Card>
   <div className="card-heading">
    <div><h2>Chamadas do GoTo Connect</h2><p>Receba os estados das ligações e os relatórios após cada chamada, sem enviar mensagens automaticamente.</p></div>
   </div>
   {callMonitor===null?<p className="muted">Consultando a integração de telefonia...</p>:<>
    <p className="muted">{callMonitor.active
     ?'Monitoramento ativo. Novas chamadas serão registradas na área Atividades.'
     :callMonitor.call_scopes_granted
      ?'Conta autorizada. Ative o monitoramento para registrar novas chamadas.'
      :'Autorize o acesso à telefonia para acompanhar chamadas e relatórios.'}</p>
    {callMonitor.last_error&&<p className="notify-alert">{callMonitor.last_error}</p>}
    {canEdit&&conn?.connected&&!callMonitor.active&&
      <div className="button-row">
       {!callMonitor.call_scopes_granted
        ?<Button secondary onClick={()=>void connect(true)}>Autorizar telefonia</Button>
        :<Button onClick={()=>void activateCalls()} disabled={busy||!callMonitor.account_configured}>{busy?'Ativando...':'Ativar monitoramento'}</Button>}
      </div>}
    {callMonitor.active&&<div className="bottom-hint">
     <span>Estados de chamada e relatórios recebidos pela GoTo.</span>
    </div>}
    {callMonitor.active&&<div className="integration-form">
     <h3>Inteligência de chamadas</h3>
     <p className="hint">Ative as atualizações pós-ligação para receber os sinais de IA e correio de voz disponíveis na sua conta GoTo. Não criamos transcrições nem enviamos mensagens automaticamente.</p>
     {callMonitor.intelligence_active
       ?<p className="success-line">Atualizações de inteligência habilitadas.</p>
       :canEdit&&<Button secondary disabled={busy} onClick={()=>void activateIntelligence()}>
        {busy?'Ativando...':'Ativar insights e correio de voz'}
       </Button>}
    </div>}
    <Link to="/activities" className="text-link">Consultar atividades</Link>
   </>}
  </Card>

  <div className="goto-catalog-banner">
   <div><strong>Modelos prontos para cadastrar na Meta</strong><span>12 sugestões por segmento, com variáveis, mídias, botões e mapeamento guiado.</span></div>
   <Link to="/template-library" className="goto-catalog-link">Explorar biblioteca</Link>
  </div>
  <Card>
   <div className="card-heading"><div><h2>Templates do WhatsApp</h2><p>Selecione um template sincronizado para configurar cada componente.</p></div>
   {canEdit&&<Button secondary onClick={sync} disabled={busy||!conn?.connected||!conn?.account_key||!conn?.from_touchpoint}>Sincronizar</Button>}
   </div>
   {templates.data.items.length?<div className="template-grid">{templates.data.items.map((t:any)=>
    <button className={'template-card '+(selected?.id===t.id?'template-selected':'')} key={t.id} onClick={()=>chooseTemplate(t)}>
     <div><span className="goto-template-type">WhatsApp</span><Status value={t.status}/></div>
     <strong>{t.name}</strong><span>{t.language_code} · {t.category||'Template'}</span>
    </button>)}</div>
   :<Empty title="Nenhum template sincronizado" subtitle="Conecte a GoTo e sincronize os templates aprovados."/>}
   <Pagination page={templates.page} pages={templates.data.pages} onChange={templates.setPage}/>
  </Card>

  <Card>
   <div className="card-heading"><div><h2>Biblioteca de mídias</h2><p>Arquivos privados do ambiente, utilizados nos cabeçalhos de templates.</p></div><span className="goto-library-count">{media.data.total||0} arquivos</span></div>
   {canEdit&&<form className="goto-media-upload" onSubmit={uploadMedia}>
    <label className="field"><span>Nome da mídia (opcional)</span><input name="label" maxLength={120} placeholder="Ex.: foto da revisão"/></label>
    <label className="field"><span>Arquivo JPG, PNG, WebP, MP4 ou PDF</span><input name="file" type="file" required accept=".jpg,.jpeg,.png,.webp,.mp4,.pdf,image/jpeg,image/png,image/webp,video/mp4,application/pdf"/></label>
    <Button type="submit" disabled={busy}>Adicionar mídia</Button>
   </form>}
   <p className="goto-help">Limites iniciais: imagem até 5 MB; vídeo ou documento até 16 MB. Os arquivos não ficam públicos, e cada ambiente tem sua própria biblioteca.</p>
   {media.data.items.length?<div className="goto-media-list">{media.data.items.map((asset:any)=><div key={asset.id} className="goto-media-row">
    <div><strong>{asset.label}</strong><small>{asset.content_type} · {(asset.size_bytes/1024/1024).toFixed(2)} MB · {asset.original_name}</small></div>
    {canEdit&&<button className="text-link" disabled={busy} onClick={()=>deleteMedia(asset.id)}>Excluir</button>}
   </div>)}</div>:<p className="goto-muted">Nenhum arquivo cadastrado neste ambiente.</p>}
   <Pagination page={media.page} pages={media.data.pages} onChange={media.setPage}/>
  </Card>

  {selected&&<>
   <div className="goto-editor-grid">
    <Card>
     <div className="card-heading"><div><div className="eyebrow">MAPEAMENTO</div><h2>{selected.name}</h2><p>Associe cada variável ao cadastro ou a um valor fixo.</p></div>
     <button className="text-link" onClick={()=>setSelected(null)}>Fechar</button></div>
     {fields.length?<div className="goto-map-fields">{fields.map(field=><MapField key={field.key} field={field}
      value={mapping[field.key]??mapping[field.name]??''}
      assets={media.data.items}
      disabled={!canEdit}
      onChange={v=>setMapping(m=>({...m,[field.key]:v}))}/>)}</div>:
      <p className="goto-muted">Template sem parâmetros ou mídia dinâmica. Os botões estáticos não exigem configuração.</p>}
     <ErrorHint error={error}/>
     {canEdit&&<div className="goto-button-footer"><Button onClick={saveMapping} disabled={busy}>Salvar mapeamento</Button></div>}
    </Card>
    <Card>
     <div className="card-heading"><div><div className="eyebrow">ESTRUTURA ORIGINAL</div><h2>Prévia do template</h2><p>Componentes recebidos da GoTo (sem alterar o modelo aprovado).</p></div></div>
     <div className="goto-template-preview">
      {sections.map((section,index)=><div key={index} className="goto-preview-section">
       <small>{section.type==='header'?'Cabeçalho':section.type==='body'?'Mensagem':section.type==='footer'?'Rodapé':'Botões'}</small>
       {section.type==='buttons'
        ?<div className="goto-preview-buttons">{(section.components||[]).map((button:any,i:number)=><div key={i} className="goto-preview-button">
         {button.attributes?.text||'Botão '+(i+1)} <span>{button.attributes?.buttonType||''}</span>
        </div>)}</div>
        :<>{previewText(section)&&<p>{previewText(section)}</p>}
         {(section.components||[]).filter((c:any)=>['image','video','document'].includes(c.type)).map((c:any,i:number)=>
         <div key={i} className="goto-preview-media">{c.type==='image'?'Imagem':c.type==='video'?'Vídeo':'Documento'} do cabeçalho</div>)}</>}
      </div>)}
     </div>
    </Card>
   </div>
   {canEdit&&<Card>
    <div className="card-heading"><div><div className="eyebrow">VALIDAÇÃO REAL</div><h2>Envio de teste</h2><p>Confirme o payload de mídia, variáveis e botões diretamente na GoTo.</p></div></div>
    <form className="goto-test-form" onSubmit={testSend}>
     <label className="field"><span>Número de teste com DDI e DDD</span><input value={testPhone} onChange={e=>setTestPhone(e.target.value)} placeholder="+5519999999999" required/></label>
     {fields.filter(f=>f.kind!=='media').map(field=><label className="field" key={field.key}>
      <span>{field.label} · valor usado somente neste teste</span>
      <input value={testValues[field.key]||''} onChange={e=>setTestValues(v=>({...v,[field.key]:e.target.value}))}
       placeholder={field.example||'Valor de teste'} required maxLength={1024}/>
     </label>)}
     {fields.some(f=>f.kind==='media')&&<label className="field"><span>Mídia deste envio de teste</span>
      <select value={testAsset} onChange={e=>setTestAsset(e.target.value)}>
       <option value="">Usar mídia salva no mapeamento</option>
       {media.data.items.filter(a=>isMatchingMedia(a.content_type,fields.find(f=>f.kind==='media')?.mediaType||'')).map(a=>
        <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
     </label>}
     <label className="goto-consent"><input type="checkbox" checked={testConsent} onChange={e=>setTestConsent(e.target.checked)}/>
      Confirmo que o titular deste número autorizou o recebimento deste teste via WhatsApp.</label>
     <div className="goto-test-actions">
      <Button disabled={busy||!testConsent||selected.status!=='APPROVED'} type="submit">Enviar teste real</Button>
      <span>Máximo de cinco testes por hora e por ambiente.</span>
     </div>
     {testResult&&<div className="success-line">{testResult}</div>}
     <ErrorHint error={error}/>
    </form>
    <div className="goto-test-history">
     <div className="goto-test-history-header">
      <strong>Últimos envios de teste</strong>
      <button type="button" className="text-link" onClick={testHistory.refresh}>Atualizar status</button>
     </div>
     <p className="goto-help">A aceitação da API não confirma a entrega. O resultado só aparece se o webhook DELIVERY_STATUS da GoTo estiver ativo.</p>
     {testHistory.error&&<ErrorHint error={testHistory.error}/>}
     {testHistory.data.items.length?
      testHistory.data.items.map((item:any)=><div className="goto-test-history-row" key={item.id}>
       <strong>{item.delivery_status==='DELIVERED'?'Entregue':
        item.delivery_status==='AWAITING_DELIVERY_STATUS'?'Aguardando retorno da GoTo':
        item.delivery_status==='NO_PROVIDER_CONFIRMATION'?'Sem confirmação de aceite':
        item.delivery_status==='INVALID_DESTINATION'?'Não entregue: destinatário inválido':
        item.delivery_status||'Sem informação de entrega'}</strong>
       <small>{new Date(item.created_at).toLocaleString('pt-BR')} · Destino #{item.recipient_fingerprint}</small>
       <small>ID GoTo: {item.provider_message_id||'Não registrado'}{item.delivery_code?' · Código '+item.delivery_code:''}</small>
      </div>):
      <p className="goto-muted">Nenhuma tentativa de teste neste ambiente.</p>}
    </div>
   </Card>}
  </>}
 </div>;
}
