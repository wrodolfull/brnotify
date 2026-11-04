import type {Request,Response,NextFunction} from 'express';
import {createClient} from '@supabase/supabase-js';
import {env} from './config.js';
import {query} from './db.js';

export const supabase=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
type Actor={id:string;email:string;superAdmin:boolean;memberships:{tenant_id:string;role:'admin'|'viewer';name:string;status:string}[]};
declare global {namespace Express {interface Request {actor?:Actor;tenantId?:string;tenantRole?:'admin'|'viewer'}}}
export const wrap=(fn:(req:Request,res:Response,next:NextFunction)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res,next)).catch(next);};
export const authenticate=wrap(async(req,res,next)=>{
  const value=req.header('authorization')||'';
  if(!value.startsWith('Bearer '))return res.status(401).json({error:'Sessão inválida ou ausente'});
  const {data,error}=await supabase.auth.getUser(value.slice(7));
  if(error||!data.user||!data.user.email_confirmed_at)return res.status(401).json({error:'Usuário não autenticado'});
  const id=data.user.id;
  const [admin,member]=await Promise.all([
    query('select 1 from platform_admins where user_id=$1',[id]),
    query('select m.tenant_id,m.role,t.name,t.segment,t.status from tenant_members m join tenants t on t.id=m.tenant_id where m.user_id=$1 order by t.name',[id])
  ]);
  if(!admin.rowCount && !member.rowCount)return res.status(403).json({error:'Acesso não provisionado pelo Super Admin'});
  req.actor={id,email:data.user.email||'',superAdmin:!!admin.rowCount,memberships:member.rows};
  next();
});
export const requireSuper=(req:Request,res:Response,next:NextFunction)=>{
  if(!req.actor?.superAdmin)return res.status(403).json({error:'Somente Super Admin'});
  next();
};
export const tenant=(write=false)=>(req:Request,res:Response,next:NextFunction)=>{
  const id=req.header('x-tenant-id');
  if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({error:'Selecione um ambiente'});
  const m=req.actor?.memberships.find(x=>x.tenant_id===id);
  if(!m && !req.actor?.superAdmin)return res.status(403).json({error:'Sem acesso a este ambiente'});
  // Super Admin pode acessar qualquer tenant existente; a rota valida existência e status no banco.
  req.tenantId=id;req.tenantRole=req.actor?.superAdmin?'admin':m?.role||'viewer';
  if(write && req.tenantRole!=='admin')return res.status(403).json({error:'Perfil somente leitura'});
  next();
};
export const activeTenant=wrap(async(req,res,next)=>{
  const result=await query('select status from tenants where id=$1',[req.tenantId]);
  if(!result.rowCount)return res.status(404).json({error:'Ambiente não encontrado'});
  if(result.rows[0].status!=='active')return res.status(423).json({error:'Ambiente pausado ou suspenso'});
  next();
});
