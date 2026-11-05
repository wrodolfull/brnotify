import crypto from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {query} from './db.js';
import {wrap} from './auth.js';

export const API_SCOPES=[
 'contacts:read','contacts:write','events:read','events:write',
 'imports:write','messages:read','messages:send'
] as const;
export type ApiScope=typeof API_SCOPES[number];

export type ApiIdentity={
 id:string;tenantId:string;label:string;scopes:ApiScope[];
};
declare global {
 namespace Express {
  interface Request {
   integrationKey?:ApiIdentity;
  }
 }
}
export function generateApiKey(){
 const token='brn_live_'+crypto.randomBytes(32).toString('hex');
 return {token,prefix:token.slice(0,18),hash:crypto.createHash('sha256').update(token).digest('hex')};
}
export function hashApiKey(token:string){
 return crypto.createHash('sha256').update(token).digest('hex');
}
export function hasScope(scopes:readonly string[],required:ApiScope){
 return scopes.includes(required);
}
export const scopesSchema=z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length)
 .refine(scopes=>new Set(scopes).size===scopes.length,'Escopos duplicados');

export const authenticateApiKey=wrap(async(req,res,next)=>{
 const bearer=req.header('authorization')||'';
 const raw=bearer.startsWith('Bearer ')?bearer.slice(7):'';
 // O formato e tamanho são estritos; a chave nunca é gravada nos logs.
 if(!/^brn_live_[a-f0-9]{64}$/.test(raw))return res.status(401).json({error:'Chave de API ausente ou inválida'});
 const found=await query(
  "select k.id,k.tenant_id,k.label,k.scopes from integration_api_keys k join tenants t on t.id=k.tenant_id where k.token_hash=$1 and k.revoked_at is null and k.expires_at>now() and t.status='active'",
  [hashApiKey(raw)]
 );
 if(!found.rowCount)return res.status(401).json({error:'Chave expirada, revogada ou ambiente indisponível'});
 const key=found.rows[0] as {id:string;tenant_id:string;label:string;scopes:ApiScope[]};
 req.integrationKey={id:key.id,tenantId:key.tenant_id,label:key.label,scopes:key.scopes};
 void query('update integration_api_keys set last_used_at=now() where id=$1',[key.id]).catch(()=>{});
 next();
});
export function requireScope(scope:ApiScope){
 return (req:Request,res:Response,next:NextFunction)=>{
  if(!req.integrationKey||!hasScope(req.integrationKey.scopes,scope))
   return res.status(403).json({error:'Chave sem permissão '+scope});
  next();
 };
}
// Rate limit de desenvolvimento: em produção com múltiplas réplicas usar Redis/shared store.
export const apiKeyRateLimiter=rateLimit({
 windowMs:60_000,limit:60,standardHeaders:'draft-7',legacyHeaders:false,
 keyGenerator:(req)=>req.integrationKey?.id||'unverified'
});
export function logIntegrationAccess(req:Request,res:Response,next:NextFunction){
 const started=Date.now(),key=req.integrationKey;
 if(!key)return next();
 const requestId=crypto.randomUUID();
 res.setHeader('X-Request-ID',requestId);
 res.on('finish',()=>{
  const path=req.route?.path ? '/v1'+String(req.route.path) : '/v1/unknown';
  void query(
   'insert into integration_api_logs(tenant_id,api_key_id,request_id,method,route,status_code,duration_ms) values($1,$2,$3,$4,$5,$6,$7)',
   [key.tenantId,key.id,requestId,req.method,path,res.statusCode,Math.max(0,Date.now()-started)]
  ).catch(()=>{});
 });
 next();
}
