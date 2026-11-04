import pg from 'pg';
import {env} from './config.js';

export const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:12,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
export const query=(sql:string,params:unknown[]=[])=>(pool.query(sql,params));
export const pageParams=(input:unknown)=>{
  const value=Number(input ?? 1);
  const page=Number.isFinite(value)?Math.max(1,Math.floor(value)):1;
  return {page,limit:20,offset:(page-1)*20};
};
export const makeSlug=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45);
export const audit=async(tenantId:string|null,userId:string|null,action:string,detail:object={})=>{
  await query('insert into audit_logs(tenant_id,user_id,action,detail) values($1,$2,$3,$4)',[tenantId,userId,action,JSON.stringify(detail)]);
};
