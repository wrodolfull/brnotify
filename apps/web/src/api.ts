import {createClient,type Session} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL||'';
const anon=import.meta.env.VITE_SUPABASE_ANON_KEY||'';
export const supabase=createClient(url,anon,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
export const API_URL=import.meta.env.VITE_API_URL||'http://localhost:4000';
export type Actor={id:string;email:string;superAdmin:boolean;memberships:{tenant_id:string;name:string;segment:string;role:'admin'|'viewer';status:string}[]};
export type Requester=(path:string,options?:RequestInit,forceTenant?:string)=>Promise<any>;
export async function callAPI(session:Session,path:string,tenantId:string,options:RequestInit={}):Promise<any>{
 const headers=new Headers(options.headers);
 headers.set('authorization','Bearer '+session.access_token);
 if(tenantId)headers.set('x-tenant-id',tenantId);
 if(options.body&&!(options.body instanceof FormData))headers.set('content-type','application/json');
 const result=await fetch(API_URL+path,{...options,headers});
 if(!result.ok){
  const err=await result.json().catch(()=>({error:'Erro de comunicação ('+result.status+')'}));
  throw new Error(err.error||'Erro HTTP '+result.status);
 }
 if(result.status===204)return null;
 const ct=result.headers.get('content-type')||'';
 if(ct.includes('spreadsheet')||ct.includes('octet-stream'))return result.blob();
 return result.json();
}
export function fmtDate(input:string|Date,withTime=false){
 return new Date(input).toLocaleString('pt-BR',withTime?{dateStyle:'short',timeStyle:'short'}:{dateStyle:'short'});
}
export function fmtNum(v:number|undefined){return Number(v||0).toLocaleString('pt-BR')}
export const typeLabel:Record<string,string>={automotive:'Automotivo',clinic:'Clínica',pet:'Pet shop',custom:'Personalizado'};
export const statuses:Record<string,string>={scheduled:'Programado',processing:'Processando',sent:'Enviado',delivered:'Entregue',failed:'Falhou',cancelled:'Cancelado',unknown:'Indeterminado'};
