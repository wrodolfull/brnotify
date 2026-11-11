import pg from 'pg';
import {env} from './config.js';

// TCP connections may be closed while idle (database maintenance, network
// resets, pooler failover). node-postgres emits these errors on the pool,
// outside any query promise. An unhandled pool 'error' crashes Node.js.
export const pool=new pg.Pool({
 connectionString:env.DATABASE_URL,
 max:12,
 connectionTimeoutMillis:10000,
 idleTimeoutMillis:30000,
 keepAlive:true,
 keepAliveInitialDelayMillis:10000
});
pool.on('error',(error:Error)=>{
 // The pool removes the broken idle connection automatically. The next query
 // opens another one; do not retry a potentially committed INSERT/UPDATE here.
 // Avoid logging the error object or pg.Client: they can expose connection
 // configuration, SQL or other sensitive data.
 const code=(error as NodeJS.ErrnoException).code;
 console.warn('[postgres] Conexão ociosa interrompida; pool descartou o cliente.',{
  code:typeof code==='string'&&/^[A-Z0-9_]{2,40}$/.test(code)?code:'UNKNOWN',
  total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount
 });
});
export const query=(sql:string,params:unknown[]=[])=>(pool.query(sql,params));
export const pageParams=(input:unknown)=>{
  const value=Number(input ?? 1);
  const page=Number.isFinite(value)?Math.max(1,Math.floor(value)):1;
  return {page,limit:50,offset:(page-1)*50};
};
export const makeSlug=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45);
export const audit=async(tenantId:string|null,userId:string|null,action:string,detail:object={})=>{
  await query('insert into audit_logs(tenant_id,user_id,action,detail) values($1,$2,$3,$4)',[tenantId,userId,action,JSON.stringify(detail)]);
};
