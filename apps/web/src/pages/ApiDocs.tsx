import {useEffect,useMemo,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,Check,ChevronDown,Copy,ExternalLink,Menu,Search,X} from 'lucide-react';
import {API_URL} from '../api';
import bundledSpec from '../api-docs-openapi.json';
import {
 collectOperations,docsGroups,endpointDocs,generatedRequest,type ApiOperation,type DocsVariant
} from '../api-docs-data';

type Language='curl'|'python'|'node';
type Spec={paths:Record<string,Record<string,any>>;components?:{schemas?:Record<string,any>}};
type Section={id:string;label:string;description:string};
const guides:Section[]=[
 {id:'intro',label:'Visão geral',description:'Comece a integrar em poucos minutos.'},
 {id:'auth',label:'Autenticação',description:'Chaves, ambientes e permissões.'},
 {id:'workflows',label:'Casos de uso',description:'Exemplos para URA, CRM e agendamentos.'},
 {id:'webhooks',label:'Webhooks',description:'Receba eventos no seu sistema.'},
 {id:'errors',label:'Erros e limites',description:'Status HTTP e boas práticas.'}
];
const currentToken='brn_live_SEU_TOKEN_AQUI';
function BodyFields({schema,spec}:{schema:any;spec:Spec}){
 if(!schema)return <p className="docs-muted">Esta operação não exige corpo JSON.</p>;
 const resolved=schema.$ref?spec.components?.schemas?.[schema.$ref.split('/').pop()||'']:schema;
 const properties=resolved?.properties||{};
 const required:string[]=resolved?.required||[];
 if(!Object.keys(properties).length)return <p className="docs-muted">Consulte o exemplo de requisição ao lado.</p>;
 return <div className="docs-fields">
  {Object.entries(properties).map(([name,definition])=>{
   const v=definition as any;
   const type=v.type|| (v.$ref?'object':'string');
   return <div className="docs-field" key={name}>
    <div><code>{name}</code><small>{type==='array'?'array':type}</small>{required.includes(name)&&<span className="docs-required">Obrigatório</span>}</div>
    <p>{v.description||fieldDescription(name)}</p>
   </div>;
  })}
 </div>;
}
const fieldDescription=(name:string):string=>({
 external_id:'Identificador único do registro no seu sistema.',
 name:'Nome do contato ou destinatário.',
 phone:'Número de telefone em formato internacional, com DDI.',
 to:'Número WhatsApp do destinatário em formato E.164.',
 template:'Nome exato do template aprovado na GoTo.',
 language:'Idioma do template, por exemplo pt_BR.',
 consent:'Confirmação de que o cliente solicitou este contato e sua origem.',
 variables:'Parâmetros do template por componente, como body.parameter_0.',
 media_asset_id:'UUID da mídia privada armazenada no ambiente.',
 contact:'Dados do cliente, incluindo nome, telefone e consentimento.',
 record:'Veículo, serviço ou outro registro associado ao evento.',
 event:'Compromisso com título, data, horário e fuso.',
 reminders:'Até três regras de antecedência para os lembretes.',
 items:'Lista de até 50 agendamentos.',
 date:'Data local no formato AAAA-MM-DD.',
 time:'Horário local no formato HH:mm.',
 title:'Título do compromisso.',
 confirmation_enabled:'Habilita o processamento de confirmações.'
} as Record<string,string>)[name]||'Parâmetro aceito por esta operação.';

function CodePreview({operation,variant,lang,base,token,onCopy}:{
 operation:ApiOperation;variant:DocsVariant;lang:Language;base:string;token:string;onCopy:(text:string)=>void
}){
 const code=generatedRequest({base,token:token||currentToken,method:operation.method,path:operation.path,variant,language:lang});
 return <div className="docs-code-box">
  <div className="docs-code-caption"><span>{lang==='curl'?'Bash / cURL':lang==='python'?'Python · requests':'Node.js · fetch'}</span>
   <button type="button" onClick={()=>onCopy(code)}><Copy size={13}/> Copiar código</button></div>
  <pre><code>{code}</code></pre>
 </div>;
}
function Overview({select}:{select:(id:string)=>void}){
 return <div className="docs-article docs-overview">
  <span className="docs-eyebrow">BR NOTIFY / DEVELOPER PLATFORM</span>
  <h1>Integre notificações ao seu sistema.</h1>
  <p className="docs-lead">Da sua URA ao WhatsApp. Do agendamento à confirmação. Uma API HTTP simples, com autenticação por ambiente, templates aprovados e respostas previsíveis.</p>
  <div className="docs-stats"><div><strong>REST</strong><span>API JSON</span></div><div><strong>Bearer</strong><span>Token por ambiente</span></div><div><strong>v1</strong><span>Versão da API</span></div></div>
  <h2>Comece por aqui</h2>
  <div className="docs-steps">
   <button onClick={()=>select('auth')}><span>01</span><div><strong>Crie uma chave de API</strong><p>Abra API e Integrações no BR Notify, escolha as permissões necessárias e copie o token exibido uma única vez.</p></div><ArrowRight size={16}/></button>
   <button onClick={()=>select('POST /messages/send')}><span>02</span><div><strong>Envie um template aprovado</strong><p>Use o número do contato e o nome de um template sincronizado da GoTo. A URA não precisa fornecer Call ID.</p></div><ArrowRight size={16}/></button>
   <button onClick={()=>select('GET /messages/send/{id}')}><span>03</span><div><strong>Acompanhe o resultado</strong><p>O HTTP 202 representa uma mensagem enfileirada; consulte o request_id para acompanhar a tentativa.</p></div><ArrowRight size={16}/></button>
  </div>
  <h2>Onde usar</h2>
  <div className="docs-uses">
   <div><strong>URA e telefonia</strong><p>Cliente escolhe continuar pelo WhatsApp e a URA chama o endpoint de envio.</p></div>
   <div><strong>ERP e CRM</strong><p>Sincronize contatos, compromissos, atualizações e importações em lote.</p></div>
   <div><strong>Atendimento</strong><p>Consulte confirmações, reagendamentos e status de entrega.</p></div>
  </div>
  <p className="docs-note">Os exemplos utilizam valores fictícios. Nada é enviado automaticamente por esta página.</p>
 </div>;
}
function Guide({id,select}:{id:string;select:(value:string)=>void}){
 if(id==='intro')return <Overview select={select}/>;
 if(id==='auth')return <div className="docs-article">
  <span className="docs-eyebrow">PRIMEIROS PASSOS</span><h1>Autenticação</h1>
  <p className="docs-lead">Todas as operações de negócio utilizam uma chave privada vinculada a um único ambiente do BR Notify.</p>
  <div className="docs-surface"><h2>Bearer Token</h2><p>Gere uma chave em <strong>API e Integrações → Chaves de API</strong>. Se o uso for uma URA, escolha <strong>Token para URA</strong>, com permissão <code>messages:send</code>.</p>
   <pre className="docs-simple-code"><code>Authorization: Bearer brn_live_SEU_TOKEN_AQUI</code></pre>
   <p>A chave é mostrada uma vez. Guarde-a no servidor ou na configuração segura da URA, nunca em URL, arquivo público ou código frontend.</p>
  </div>
  <h2>Escopos disponíveis</h2>
  <div className="docs-fields">{[
   ['contacts:read','Consultar contatos'],
   ['contacts:write','Cadastrar e atualizar contatos'],
   ['events:read','Consultar agendamentos'],
   ['events:write','Criar, editar e cancelar compromissos'],
   ['imports:write','Importar até 50 agendamentos por lote'],
   ['messages:read','Consultar status dos lembretes'],
   ['messages:send','Enviar templates sob demanda (URA/CRM)']
  ].map(([scope,description])=><div className="docs-field" key={scope}><div><code>{scope}</code></div><p>{description}</p></div>)}</div>
  <p className="docs-note">Limite padrão: 60 requisições por minuto por chave em uma instância da API. Em instalações com múltiplas réplicas, consulte os limites operacionais configurados.</p>
 </div>;
 if(id==='workflows')return <div className="docs-article">
  <span className="docs-eyebrow">RECEITAS DE INTEGRAÇÃO</span><h1>Casos de uso</h1>
  <p className="docs-lead">Exemplos de fluxos comuns. Selecione uma operação para ver os exemplos em cURL, Python e Node.js.</p>
  <div className="docs-steps">
   {[
    ['URA → WhatsApp','O cliente escolhe receber o WhatsApp. A URA envia telefone e template, sem Call ID.','POST /messages/send'],
    ['CRM → Agendamento','Cadastre contato, veículo, data e até três notificações em uma chamada.','POST /reminders'],
    ['ERP → Atualização','Altere um agendamento existente pelo external_id e reprograme lembretes futuros.','PATCH /events/{externalId}'],
    ['Lote → Importação','Sincronize até 50 compromissos por vez e confira falhas por item.','POST /imports']
   ].map(([title,description,to],i)=><button key={title} onClick={()=>select(to)}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{title}</strong><p>{description}</p></div><ArrowRight size={16}/></button>)}
  </div>
 </div>;
 if(id==='webhooks')return <div className="docs-article">
  <span className="docs-eyebrow">INTEGRAÇÕES / CALLBACKS</span><h1>Webhooks</h1>
  <p className="docs-lead">Receba atualizações do BR Notify sem precisar consultar o status em intervalos fixos.</p>
  <div className="docs-surface"><h2>Como configurar</h2>
   <p>Abra <strong>API e Integrações → Webhooks</strong> e informe uma URL HTTPS controlada por você. Selecione os eventos desejados e armazene o segredo de assinatura exibido uma única vez.</p>
   <p>O BR Notify assina as entregas com HMAC. Valide a assinatura no servidor de destino antes de aceitar qualquer evento.</p>
  </div>
  <h2>Eventos publicados</h2>
  <div className="docs-fields">{[
   ['reminder.sent','Requisição de mensagem aceita pelo provedor.'],
   ['reminder.delivered','Entrega confirmada pelo webhook da GoTo.'],
   ['reminder.failed','Falha de envio registrada.'],
   ['event.cancelled','Compromisso cancelado.'],
   ['appointment.confirmed','Cliente confirmou presença.'],
   ['appointment.reschedule_requested','Cliente solicitou reagendamento.'],
   ['appointment.declined','Cliente recusou o agendamento.']
  ].map(([name,description])=><div key={name} className="docs-field"><div><code>{name}</code></div><p>{description}</p></div>)}</div>
  <p className="docs-note">Esses webhooks são configurados na interface administrativa do BR Notify, não pelo endpoint público /v1. Entregas são assíncronas e podem ser repetidas; implemente idempotência no receptor.</p>
 </div>;
 return <div className="docs-article">
  <span className="docs-eyebrow">SUPORTE À INTEGRAÇÃO</span><h1>Erros e limites</h1>
  <p className="docs-lead">Os códigos HTTP informam a situação da requisição. Um pedido aceito na fila ainda não equivale à entrega do WhatsApp.</p>
  <div className="docs-fields">{[
   ['200 / 201','Operação realizada ou registro criado.'],
   ['202','Pedido de disparo enfileirado. Consulte request_id para acompanhar.'],
   ['207','Importação em lote com resultado individual de cada registro.'],
   ['401','Token inválido, expirado ou revogado.'],
   ['403','A chave não possui o escopo exigido.'],
   ['404','Recurso não encontrado no ambiente autorizado.'],
   ['409','Conflito de estado, vínculo, opt-out ou integração.'],
   ['422','Corpo ou parâmetros inválidos, incluindo template não aprovado.'],
   ['429','Limite de requisições ou disparos atingido; respeite Retry-After.'],
   ['500 / 502','Erro interno ou indisponibilidade do provedor.']
  ].map(([status,meaning])=><div key={status} className="docs-field"><div><code>{status}</code></div><p>{meaning}</p></div>)}</div>
  <div className="docs-surface"><h2>Cuidados com mensagens WhatsApp</h2><p>O BR Notify utiliza cadência no worker, deduplicação e controle de tentativas. Esses mecanismos não substituem opt-in válido, templates aprovados ou as políticas da Meta.</p><p>Mensagens marcadas <code>unknown</code> precisam de conciliação antes de qualquer novo envio, para evitar duplicações.</p></div>
 </div>;
}
export function ApiDocs(){
 const [params,setParams]=useSearchParams();
 const [spec,setSpec]=useState<Spec>(bundledSpec as Spec);
 const [live,setLive]=useState(false);
 const [search,setSearch]=useState('');
 const [lang,setLang]=useState<Language>('curl');
 const [base,setBase]=useState(API_URL);
 const [token,setToken]=useState('');
 const [mobileMenu,setMobileMenu]=useState(false);
 const [copied,setCopied]=useState(false);
 const [variantIndex,setVariantIndex]=useState(0);
 const selectedId=params.get('endpoint')||params.get('guide')||'intro';
 const operations=useMemo(()=>collectOperations(spec),[spec]);
 const selected=operations.find(o=>o.id===selectedId);
 const guide=guides.find(g=>g.id===selectedId);
 const endpointCount=operations.length;

 useEffect(()=>{
  const controller=new AbortController();
  fetch(API_URL+'/v1/openapi.json',{signal:controller.signal})
   .then(r=>{if(!r.ok)throw Error('offline');return r.json()})
   .then(data=>{if(data?.openapi&&data?.paths){setSpec(data);setLive(true)}})
   .catch(()=>{});
  return()=>controller.abort();
 },[]);
 const filtered=useMemo(()=>{
  const key=search.trim().toLocaleLowerCase('pt-BR');
  return operations.filter(o=>!key||(o.path+' '+o.summary+' '+o.description+' '+o.method).toLocaleLowerCase('pt-BR').includes(key));
 },[operations,search]);
 const select=(id:string)=>{
  if(guides.some(g=>g.id===id))setParams(id==='intro'?{}:{guide:id});
  else setParams({endpoint:id});
  setVariantIndex(0);setCopied(false);setMobileMenu(false);
  window.scrollTo({top:0,behavior:'smooth'});
 };
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopied(true);window.setTimeout(()=>setCopied(false),1800)}catch{setCopied(false)}};
 const variant=selected?.variants[Math.min(variantIndex,Math.max(0,selected.variants.length-1))];
 const methodColor=(method:string)=>method.toLowerCase();
 const schema=selected?(spec.paths[selected.path]?.[selected.method.toLowerCase()]?.requestBody?.content?.['application/json']?.schema):null;
 const responseExample=variant?.response??selected?.response??selected?.variants.find(v=>v.response)?.response;
 const responseStatus=selected?.method==='POST'&&selected.path==='/messages/send'?'202':
  selected?.method==='POST'&&selected.path==='/imports'?'207':
  selected?.method==='POST'&&['/reminders','/events'].includes(selected.path)?'201':'200';
 return <div className="docs-root">
  <header className="docs-topbar">
   <div className="docs-brand"><Link to="/" aria-label="BR Notify — voltar ao sistema"><span className="docs-brand-mark">BR</span><strong>Notify</strong></Link><span className="docs-brand-sep">/</span><span>Developers</span></div>
   <div className="docs-top-actions"><a href={API_URL+'/v1/openapi.json'} target="_blank" rel="noopener noreferrer">OpenAPI JSON <ExternalLink size={13}/></a><Link to="/" className="docs-to-app">Abrir plataforma <ArrowRight size={14}/></Link></div>
   <button className="docs-menu-toggle" type="button" aria-label="Abrir índice" onClick={()=>setMobileMenu(true)}><Menu size={20}/></button>
  </header>
  {mobileMenu&&<button className="docs-mobile-shade" aria-label="Fechar índice" onClick={()=>setMobileMenu(false)}/>}
  <aside className={'docs-sidebar '+(mobileMenu?'docs-sidebar-open':'')}>
   <div className="docs-sidebar-head"><span>DOCUMENTAÇÃO</span><button type="button" onClick={()=>setMobileMenu(false)} aria-label="Fechar menu"><X size={18}/></button></div>
   <label className="docs-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar endpoint..." aria-label="Buscar na documentação"/></label>
   <div className="docs-tree">
    <div className="docs-group-title">COMEÇAR</div>
    {guides.map(g=><button key={g.id} type="button" className={'docs-nav-guide '+(selectedId===g.id?'docs-nav-active':'')} onClick={()=>select(g.id)}>{g.label}</button>)}
    {docsGroups.map(group=>{
     const matches=filtered.filter(op=>op.group===group.id);
     if(!matches.length)return null;
     return <section key={group.id} aria-label={group.label}>
      <div className="docs-group-title">{group.label.toUpperCase()} <span>{matches.length}</span></div>
      {matches.map(op=><button key={op.id} type="button" onClick={()=>select(op.id)} className={'docs-nav-endpoint '+(selectedId===op.id?'docs-nav-active':'')} title={op.method+' '+op.path}>
       <span className={'docs-method-small docs-method-'+methodColor(op.method)}>{op.method}</span><span>{op.summary}</span>
      </button>)}
     </section>;
    })}
   </div>
   <div className="docs-sidebar-footer"><div>API Reference · v1</div><small>{endpointCount} operações documentadas</small></div>
  </aside>
  <div className="docs-main">
   <div className="docs-main-inner">
    {!selected?<Guide id={guide?.id||'intro'} select={select}/>:
    <>
     <div className="docs-article">
      <div className="docs-breadcrumb"><button onClick={()=>select('intro')}>Documentação</button><span>/</span><span>{selected.group}</span></div>
      <span className="docs-eyebrow">REFERÊNCIA DA API · V1</span>
      <h1>{selected.summary}</h1>
      <p className="docs-lead">{selected.description}</p>
      <div className="docs-endpoint-bar"><span className={'docs-method docs-method-'+methodColor(selected.method)}>{selected.method}</span><code>/v1{selected.path}</code><button type="button" title="Copiar caminho" onClick={()=>copy('/v1'+selected.path)}>{copied?<Check size={15}/>:<Copy size={15}/>}</button></div>
      <h2>Autenticação e permissões</h2>
      <p>Toda requisição precisa de um token Bearer válido do ambiente. Para esta operação, a chave precisa dos seguintes escopos:</p>
      <div className="docs-scopes">{selected.scopes.length?selected.scopes.map(scope=><code key={scope}>{scope}</code>):<span>Consulte os requisitos no OpenAPI.</span>}</div>
      {selected.variants.length>1&&<><h2>Exemplos de utilização</h2><p>Escolha o cenário que corresponde à sua integração. O método e a rota continuam os mesmos; o conteúdo da requisição é que muda.</p>
       <div className="docs-scenario-tabs" role="group" aria-label="Cenário do endpoint">{selected.variants.map((v,i)=><button type="button" key={v.id} className={i===variantIndex?'docs-scenario-current':''} onClick={()=>setVariantIndex(i)}>{v.label}</button>)}</div>
       {variant?.description&&<p className="docs-variant-description">{variant.description}</p>}
      </>}
      <h2>Parâmetros da requisição</h2>
      {schema?<BodyFields schema={schema} spec={spec}/>:variant?.body?<div className="docs-fields">{Object.keys(variant.body as object).map(field=><div className="docs-field" key={field}><div><code>{field}</code></div><p>{fieldDescription(field)}</p></div>)}</div>:<p className="docs-muted">Esta operação recebe parâmetros no caminho ou na consulta da URL. Veja o exemplo ao lado.</p>}
      {selected.hints.length>0&&<><h2>Observações</h2><ul className="docs-bullets">{selected.hints.map((hint,i)=><li key={i}>{hint}</li>)}</ul></>}
      <h2>Resposta esperada</h2><p>O retorno depende do resultado da operação e das informações do ambiente. Abaixo está um exemplo ilustrativo.</p>
      <pre className="docs-response"><code>{JSON.stringify(responseExample||{status:"ok"},null,2)}</code></pre>
      <p className="docs-note">Exemplos fictícios. Uma resposta de envio <strong>202</strong> significa enfileirado, não entregue ao WhatsApp.</p>
     </div>
     <aside className="docs-playground">
      <div className="docs-playground-head"><div><strong>Exemplo de requisição</strong><span>Copie e adapte no seu projeto</span></div><span className="docs-playground-label">HTTP</span></div>
      <div className="docs-exec-settings">
       <label><span>URL base da API</span><input aria-label="URL base da API" value={base} onChange={e=>setBase(e.target.value)} spellCheck={false}/></label>
       <label><span>Token de API <small>(apenas nesta tela)</small></span><input type="password" autoComplete="off" aria-label="Token de exemplo" value={token} onChange={e=>setToken(e.target.value)} placeholder={currentToken}/></label>
       <p>O token não é enviado, executado nem armazenado nesta página. Use os exemplos no seu servidor ou ferramenta de testes.</p>
      </div>
      <div className="docs-code-tabs" role="tablist" aria-label="Linguagem do exemplo">
       {(['curl','python','node'] as Language[]).map(l=><button key={l} role="tab" aria-selected={lang===l} className={lang===l?'docs-code-active':''} onClick={()=>setLang(l)}>{l==='curl'?'cURL':l==='python'?'Python':'Node.js'}</button>)}
      </div>
      {variant&&<CodePreview operation={selected} variant={variant} lang={lang} base={base} token={token} onCopy={copy}/>}
      <div className="docs-playground-response"><div><span>Exemplo de resposta</span><strong>HTTP {responseStatus}</strong></div><pre><code>{JSON.stringify(responseExample||{success:true},null,2)}</code></pre></div>
      <p className="docs-playground-foot">{live?'Especificação sincronizada com a API.':'Referência incluída no portal; API indisponível para consulta ao vivo.'}</p>
     </aside>
    </>
    }
    <footer className="docs-footer"><span>BR Notify · Developer Documentation</span><div><button type="button" onClick={()=>select('errors')}>Suporte e erros</button><Link to="/">Voltar ao sistema <ArrowLeft size={12}/></Link></div></footer>
   </div>
  </div>
 </div>;
}
