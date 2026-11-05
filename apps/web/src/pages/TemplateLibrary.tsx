import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {useApp} from '../context';
import {Button,Card,ErrorHint,Loader,PageTitle} from '../components';

type Segment='all'|'automotive'|'clinic'|'pet'|'custom';
type Variable={part:'body'|'header'|'button';position:number;buttonIndex?:number;label:string;example:string;selector:string;manual?:boolean};
type ButtonDef={type:'QUICK_REPLY'|'URL';text:string;url?:string};
type Preset={
 id:string;segment:Exclude<Segment,'all'>;name:string;title:string;description:string;
 languageCode:string;suggestedCategory:string;suggestedOffsetDays:number;
 header?:{type:'TEXT'|'IMAGE'|'VIDEO'|'DOCUMENT';text?:string};
 body:string;footer?:string;buttons:ButtonDef[];variables:Variable[];guidance:string
};
type Match={
 matched:boolean;reason?:string;
 template?:{id:string;name:string;language_code:string;status:string};
 compatible?:boolean;issues?:string[];suggested?:Record<string,string>;
 requiredMedia?:boolean;manualFields?:string[];current_mapping?:Record<string,string>;
 can_apply?:boolean;
};
const segments:{id:Segment;label:string}[]=[
 {id:'all',label:'Todos'},{id:'automotive',label:'Automotivo'},
 {id:'clinic',label:'Clínicas'},{id:'pet',label:'Pet shops'},
 {id:'custom',label:'Genéricos'}
];
const labels:Record<string,string>={automotive:'Automotivo',clinic:'Clínicas',pet:'Pet shops',custom:'Genérico'};
const headerLabels:Record<string,string>={TEXT:'Texto',IMAGE:'Imagem',VIDEO:'Vídeo',DOCUMENT:'Documento'};
function placeholderPreview(text:string,variables:Variable[],part:'header'|'body'){
 return text.replace(/\{\{(\d+)\}\}/g,(_m:string,index:string)=>{
  const found=variables.find(v=>v.part===part&&v.position===Number(index));
  return found?'['+found.example+']':'[variável '+index+']';
 });
}
function metaKit(model:Preset){
 const lines=[
  'MODELO SUGERIDO — BR NOTIFY',
  'Nome: '+model.name,'Idioma: Português (Brasil) / '+model.languageCode,
  'Categoria sugerida: Utilidade (sujeita à classificação e aprovação da Meta)',
  'Antecedência sugerida: '+model.suggestedOffsetDays+' dia(s)',
  '',
  'CABEÇALHO',
  model.header?(model.header.type==='TEXT'?model.header.text||'Texto':'Mídia: '+headerLabels[model.header.type]):'Sem cabeçalho',
  '', 'CORPO',model.body,'','RODAPÉ',model.footer||'Sem rodapé','',
  'BOTÕES',
  ...(model.buttons.length?model.buttons.map((b,i)=>
   (i+1)+'. '+b.text+' ('+(b.type==='QUICK_REPLY'?'Resposta rápida':'URL')+')'+(b.url?' — '+b.url:'')):['Nenhum']),
  '','EXEMPLOS PARA A META',
  ...model.variables.map(v=>(v.part==='button'?'Botão '+((v.buttonIndex||0)+1):v.part==='header'?'Cabeçalho':'Corpo')+' {{'+v.position+'}}: '+v.example+' — BR Notify: '+v.selector),
  '', 'OBSERVAÇÕES',model.guidance,
  'Esse texto não cria, registra nem aprova templates automaticamente.'
 ];
 return lines.join('\n');
}
function CardFlag({children}:{children:ReactNode}){return <span className="catalog-pill">{children}</span>}
export function TemplateLibrary(){
 const {api,role,segment:tenantSegment,notify,tenantId}=useApp();
 const [items,setItems]=useState<Preset[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [segment,setSegment]=useState<Segment>('all');
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState<Preset|null>(null);
 const [match,setMatch]=useState<Match|null>(null);
 const [matching,setMatching]=useState(false);
 const [applying,setApplying]=useState(false);
 const detailRef=useRef<HTMLDivElement|null>(null);
 const canEdit=role==='admin';

 useEffect(()=>{
  let alive=true;setLoading(true);setError('');setSelected(null);setMatch(null);
  api('/api/template-library').then(data=>{
   if(alive){setItems(data.items||[]);setSegment(['automotive','clinic','pet'].includes(tenantSegment)?tenantSegment as Segment:'all')}
  }).catch((e:Error)=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[api,tenantId,tenantSegment]);

 const visible=useMemo(()=>items.filter(p=>
  (segment==='all'||p.segment===segment)&&
  [p.title,p.name,p.description].some(x=>x.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
 ),[items,segment,search]);

 const select=(preset:Preset)=>{
  setSelected(preset);setMatching(true);setMatch(null);
  api('/api/template-library/'+encodeURIComponent(preset.id)+'/match')
   .then(v=>setMatch(v)).catch((e:Error)=>setMatch({matched:false,reason:e.message}))
   .finally(()=>setMatching(false));
  if(window.matchMedia('(max-width: 860px)').matches)
   requestAnimationFrame(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
 };
 const copy=async(label:string,value:string)=>{
  try{await navigator.clipboard.writeText(value);notify(label+' copiado')}
  catch{notify('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.','error')}
 };
 const refreshMatch=async()=>{
  if(!selected)return;
  setMatching(true);
  try{
   const data=await api('/api/template-library/'+encodeURIComponent(selected.id)+'/match');
   setMatch(data);notify('Status do modelo atualizado');
  }catch(e:any){notify(e.message,'error')}finally{setMatching(false)}
 };
 const apply=async()=>{
  if(!selected||!match?.template||!match.can_apply||!canEdit)return;
  setApplying(true);
  try{
   const data=await api('/api/template-library/'+encodeURIComponent(selected.id)+'/apply',{
    method:'POST',body:JSON.stringify({template_id:match.template.id,overwrite:false})
   });
   setMatch(v=>v?{...v,current_mapping:data.saved.variable_map}:v);
   notify('Mapeamento sugerido aplicado. Revise mídia e campos personalizados na GoTo.');
  }catch(e:any){notify(e.message,'error')}finally{setApplying(false)}
 };
 const example=(v:Variable)=>v.example;
 return <div className="catalog-page">
  <PageTitle eyebrow="GOTO CONNECT / MODELOS SUGERIDOS" title="Biblioteca de modelos"
   subtitle="12 sugestões prontas para cadastrar na Meta e conectar aos lembretes do BR Notify."
   action={<Link to="/settings" className="catalog-back">Voltar à GoTo</Link>}/>
  <div className="catalog-notice"><strong>Modelos de referência, não templates aprovados.</strong><span>O cadastro é feito no WhatsApp Manager da Meta. Após aprovação, sincronize pela GoTo e aplique o mapeamento sugerido.</span></div>
  <div className="catalog-filter">
   <div className="catalog-tabs" role="group" aria-label="Filtrar por segmento">
    {segments.map(s=><button key={s.id} type="button" aria-pressed={segment===s.id}
      className={segment===s.id?'catalog-tab-selected':''} onClick={()=>setSegment(s.id)}>{s.label}</button>)}
   </div>
   <input aria-label="Buscar modelos" value={search} onChange={e=>setSearch(e.target.value)}
    placeholder="Buscar por nome ou finalidade"/>
  </div>
  <ErrorHint error={error}/>
  {loading?<Loader/>:<>
   <div className="catalog-overview">
    <span>{visible.length} {visible.length===1?'modelo encontrado':'modelos encontrados'}</span>
    <span>Português (Brasil) · Utilidade sugerida</span>
   </div>
   <div className="catalog-layout">
    <div className="catalog-grid">
     {visible.map((item,i)=><button type="button" key={item.id} onClick={()=>select(item)}
      className={'catalog-model '+(selected?.id===item.id?'catalog-model-active':'')}>
      <div className="catalog-model-top"><span>{labels[item.segment]}</span><small>{String(i+1).padStart(2,'0')}</small></div>
      <h3>{item.title}</h3><p>{item.description}</p>
      <div className="catalog-model-tags">
       <CardFlag>{item.suggestedOffsetDays} {item.suggestedOffsetDays===1?'dia':'dias'} antes</CardFlag>
       {item.header&&<CardFlag>{headerLabels[item.header.type]}</CardFlag>}
       {item.buttons.length>0&&<CardFlag>{item.buttons.length} {item.buttons.length===1?'botão':'botões'}</CardFlag>}
      </div>
      <span className="catalog-model-more">Ver modelo <span aria-hidden="true">→</span></span>
     </button>)}
     {visible.length===0&&<div className="catalog-empty">Nenhum modelo encontrado. Experimente outro segmento ou busca.</div>}
    </div>

    <div className="catalog-detail" ref={detailRef} id="catalog-detail">
     {!selected?<div className="catalog-detail-placeholder"><strong>Escolha um modelo</strong><p>Confira o conteúdo, as variáveis e as instruções de cadastro na Meta.</p></div>:
      <Card>
       <div className="catalog-detail-head">
        <div><span className="catalog-kicker">{labels[selected.segment]} · {selected.suggestedOffsetDays} dia(s) antes</span><h2>{selected.title}</h2><p>{selected.description}</p></div>
        <button type="button" className="catalog-close" onClick={()=>setSelected(null)}>Fechar</button>
       </div>
       <div className="catalog-meta">
        <div><span>Nome na Meta</span><div><code>{selected.name}</code><button type="button" onClick={()=>copy('Nome do modelo',selected.name)}>Copiar</button></div></div>
        <div><span>Idioma e categoria</span><strong>Português (Brasil) · Utilidade sugerida</strong></div>
       </div>
       <div className="catalog-preview">
        <div className="catalog-preview-top">Prévia com dados de exemplo</div>
        <div className="catalog-bubble">
         {selected.header&&<div className="catalog-preview-header">
          {selected.header.type==='TEXT'
           ?placeholderPreview(selected.header.text||'',selected.variables,'header')
           :'Cabeçalho com '+headerLabels[selected.header.type].toLowerCase()+' — selecione o arquivo na Meta'}
         </div>}
         <div className="catalog-preview-body">{placeholderPreview(selected.body,selected.variables,'body')}</div>
         {selected.footer&&<div className="catalog-preview-footer">{selected.footer}</div>}
        </div>
        {selected.buttons.map((button,i)=><div className="catalog-button-preview" key={i}>{button.text}{button.type==='URL'&&<small>Link</small>}</div>)}
       </div>
       <div className="catalog-copy-grid">
        <button type="button" onClick={()=>copy('Mensagem',selected.body)}>Copiar texto</button>
        <button type="button" onClick={()=>copy('Kit completo',metaKit(selected))}>Copiar kit completo</button>
        {selected.header?.type==='TEXT'&&<button type="button" onClick={()=>copy('Cabeçalho',selected.header!.text||'')}>Copiar cabeçalho</button>}
       </div>
       <div className="catalog-details-section"><h3>Variáveis e exemplos para a Meta</h3>
        <div className="catalog-variable-list">{selected.variables.map((v,i)=><div key={i}>
         <code>{v.part==='header'?'Cabeçalho':v.part==='button'?'Botão '+((v.buttonIndex||0)+1):'Corpo'} {'{{'+v.position+'}}'}</code>
         <strong>{v.label}</strong><span>{example(v)}</span>
         <small>Campo: {v.selector}{v.manual?' · requer configuração':''}</small>
        </div>)}</div>
       </div>
       <div className="catalog-details-section"><h3>Botões</h3>
        {selected.buttons.length?selected.buttons.map((b,i)=><div className="catalog-button-definition" key={i}>
         <strong>{b.text}</strong><span>{b.type==='QUICK_REPLY'?'Resposta rápida':'URL dinâmica'}{b.url?' · '+b.url:''}</span>
        </div>):<p className="catalog-muted">Este modelo não usa botões.</p>}
       </div>
       <div className="catalog-guidance">{selected.guidance}</div>
       <div className="catalog-details-section"><h3>Como utilizar</h3>
        <ol className="catalog-steps">
         <li>Copie o kit e crie o template com o nome e idioma indicados no WhatsApp Manager.</li>
         <li>Inclua cabeçalho, variáveis, exemplos e botões conforme o modelo. Envie para aprovação.</li>
         <li>Após aprovação, sincronize os templates na tela GoTo Connect.</li>
         <li>Verifique a correspondência abaixo e aplique o mapeamento.</li>
        </ol>
        <a className="catalog-meta-link" href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener noreferrer">Abrir WhatsApp Manager</a>
       </div>
       <div className="catalog-match">
        <div className="catalog-match-head"><div><strong>Vínculo com a GoTo</strong><small>Exige nome, idioma e estrutura correspondentes</small></div>
         <button type="button" onClick={refreshMatch} disabled={matching}>Verificar novamente</button></div>
        {matching?<p>Conferindo templates sincronizados...</p>:
         !match?.matched?<p>{match?.reason||'Ainda não há template sincronizado com esse nome.'}</p>:
         <div className="catalog-match-result">
          <div><strong>{match.template?.status==='APPROVED'?'Aprovado na GoTo':'Aguardando aprovação'}</strong>
           <span>{match.template?.name} · {match.template?.language_code}</span></div>
          {!match.compatible&&<p className="catalog-match-error">A estrutura diverge: {(match.issues||[]).join('; ')}</p>}
          {match.compatible&&<p>{Object.keys(match.suggested||{}).length} variáveis com sugestão de mapeamento.
           {match.requiredMedia?' Selecione uma mídia na biblioteca privada depois de aplicar.':''}</p>}
          {canEdit&&match.can_apply&&<Button onClick={apply} disabled={applying}>{applying?'Aplicando...':'Aplicar mapeamento sugerido'}</Button>}
          {!canEdit&&<p>Somente administradores podem aplicar mapeamentos.</p>}
         </div>}
        <p className="catalog-match-note">Valores existentes são preservados. O BR Notify não cria nem aprova modelos na Meta.</p>
       </div>
      </Card>}
    </div>
   </div>
  </>}
 </div>;
}
