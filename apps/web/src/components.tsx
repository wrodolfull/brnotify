import {useEffect,useState,type ReactNode,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,Plus,Search,X,LoaderCircle,Inbox} from 'lucide-react';
import {useApp} from './context';
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
export function useList(path:string,enabled=true){
 const {api}=useApp();
 const [data,setData]=useState<{items:any[];total:number;pages:number}>({items:[],total:0,pages:1});
 const [page,setPage]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!enabled)return;let alive=true;setLoading(true);api(path+(path.includes('?')?'&':'?')+'page='+page).then(v=>{if(alive){setData({items:v.items||[],total:v.total||0,pages:v.pages||1});setError('')}}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[api,path,page,revision,enabled]);
 return {data,page,setPage,loading,error,refresh:()=>setRevision(v=>v+1)};
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
