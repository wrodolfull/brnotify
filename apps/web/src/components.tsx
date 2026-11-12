import {useEffect,useState,type ReactNode,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,Plus,Search,X,LoaderCircle,Inbox} from 'lucide-react';
import {useApp} from './context';
import {loadQuery,peekQuery,queryKey} from './query-cache';
export function Card({children,className=''}:{children:ReactNode;className?:string}){return <section className={'card '+className}>{children}</section>}
export function PageTitle({eyebrow,title,subtitle,action}:{eyebrow?:string;title:string;subtitle?:string;action?:ReactNode}){
 return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{action&&<div className="page-action">{action}</div>}</div>;
}
export function Button({children,onClick,type='button',secondary=false,danger=false,disabled=false}:{children:ReactNode;onClick?:()=>void;type?:'button'|'submit';secondary?:boolean;danger?:boolean;disabled?:boolean}){
 return <button type={type} className={'button '+(secondary?'button-secondary ':'')+(danger?'button-danger':'')} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 useEffect(()=>{const f=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[onClose]);
 return <div className="modal-shade" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19}/></button></header>{children}</div></div>;
}
export function Status({value}:{value:string}){return <span className={'status status-'+value}>{({scheduled:'Programado',queued:'Na fila',processing:'Processando',sent:'Aceito pela GoTo',delivered:'Entregue',failed:'Falhou',cancelled:'Cancelado',unknown:'Indeterminado',active:'Ativo',paused:'Pausado',suspended:'Suspenso',APPROVED:'Aprovado'} as Record<string,string>)[value]||value}</span>}
export function Empty({title='Nenhum registro',subtitle='Quando houver dados, eles aparecerão aqui.'}:{title?:string;subtitle?:string}){return <div className="empty-state"><Inbox size={30} strokeWidth={1.5}/><strong>{title}</strong><span>{subtitle}</span></div>}
export function ErrorHint({error}:{error:string}){return error?<div className="inline-error">{error}</div>:null}
type QueryState<T>={key:string;data:T|undefined;loading:boolean;refreshing:boolean;error:string};

// Show previously fetched data immediately when a screen is revisited. Refresh
// stale snapshots without replacing them with empty states or full-page spinners.
export function useCachedData<T>(path:string,enabled=true){
 const {api,actor,tenantId}=useApp();
 const key=queryKey(actor.id,tenantId,path);
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState<QueryState<T>>(()=>{
  const data=peekQuery<T>(key);
  return {key,data,loading:data===undefined,refreshing:false,error:''};
 });
 const snapshot=state.key===key?state:(()=>{
  const data=peekQuery<T>(key);
  return {key,data,loading:data===undefined,refreshing:false,error:''};
 })();
 useEffect(()=>{
  if(!enabled)return;
  let alive=true;
  const cached=peekQuery<T>(key);
  setState({key,data:cached,loading:cached===undefined,refreshing:cached!==undefined,error:''});
  loadQuery<T>(key,()=>api(path),revision>0).then(data=>{
   if(alive)setState({key,data,loading:false,refreshing:false,error:''});
  }).catch((e:Error)=>{
   if(alive)setState({key,data:peekQuery<T>(key),loading:false,refreshing:false,error:e.message||'Falha ao carregar dados'});
  });
  return()=>{alive=false};
 },[api,key,path,revision,enabled]);
 return {...snapshot,refresh:()=>setRevision(r=>r+1)};
}

type ListData={items:any[];total:number;pages:number};
export function useList(path:string,enabled=true){
 const [page,setPage]=useState(1);
 const query=path+(path.includes('?')?'&':'?')+'page='+page;
 const result=useCachedData<ListData>(query,enabled);
 return {...result,data:result.data||{items:[],total:0,pages:1},page,setPage};
}
export function Pagination({page,pages,onChange}:{page:number;pages:number;onChange:(p:number)=>void}){
 if(pages<=1)return null;
 return <div className="pagination"><span>Página {page} de {pages}</span><div><button aria-label="Anterior" disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={18}/></button><button aria-label="Próxima" disabled={page>=pages} onClick={()=>onChange(page+1)}><ChevronRight size={18}/></button></div></div>;
}
export function Input({label,name,type='text',required=false,defaultValue,placeholder,min,max}:{label:string;name:string;type?:string;required?:boolean;defaultValue?:string|number;placeholder?:string;min?:string|number;max?:string|number}){
 return <label className="field"><span>{label}</span><input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} min={min} max={max}/></label>;
}
export const formValues=(e:FormEvent<HTMLFormElement>)=>Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string,string>;
export function SubmitRow({onCancel,busy=false,label='Salvar'}:{onCancel:()=>void;busy?:boolean;label?:string}){return <footer className="form-footer"><Button secondary onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:null}{label}</Button></footer>}
export function SearchBox({value,onChange,placeholder='Buscar...'}:{value:string;onChange:(value:string)=>void;placeholder?:string}){return <label className="search-box"><Search size={18}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} aria-label="Buscar"/></label>}
export function NewButton({onClick,label='Adicionar'}:{onClick:()=>void;label?:string}){return <Button onClick={onClick}><Plus size={17}/>{label}</Button>}
export function Loader(){return <div className="loading"><LoaderCircle className="spin" size={24}/> Carregando...</div>}
