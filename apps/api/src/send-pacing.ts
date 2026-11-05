import crypto from 'node:crypto';
import type {SqlRunner} from './time.js';
import {pool} from './db.js';

export const MIN_TENANT_DELAY_MS=1000;
export const MAX_TENANT_DELAY_MS=5000;
export const GLOBAL_MIN_DELAY_MS=1000;
// Delays are pacing, not a WhatsApp ban-prevention guarantee.
export function randomTenantDelay():number{
 return crypto.randomInt(MIN_TENANT_DELAY_MS,MAX_TENANT_DELAY_MS+1);
}
export function retryAfterMilliseconds(value:string|null,now=Date.now()):number|null{
 if(!value||value.length>120)return null;
 const raw=value.trim();
 let ms:number;
 if(/^\d+$/.test(raw))ms=Number(raw)*1000;
 else{
  const time=Date.parse(raw);
  if(!Number.isFinite(time))return null;
  ms=time-now;
 }
 if(!Number.isFinite(ms))return null;
 return Math.min(3600_000,Math.max(1000,Math.ceil(ms)));
}
export function retryDelayMilliseconds(attempt:number,retryAfterMs:number|null):number{
 const exponential=Math.min(15*60_000,30_000*Math.pow(2,Math.max(0,attempt-1)));
 return Math.max(exponential+crypto.randomInt(1000,5001),retryAfterMs??0);
}
export type FailureClass='retry'|'unknown'|'failed';
export function classifyProviderFailure(status:number|null,attempt:number):FailureClass{
 // 5xx, timeout or missing ID can hide an accepted message: do not auto-resend.
 if(status===0||(status!==null&&status>=500))return 'unknown';
 // 429 explicitly means rate limited; postpone and honor Retry-After.
 if(status===429)return attempt<5?'retry':'failed';
 return 'failed';
}
export async function withDispatchTransaction<T>(
 fn:(run:SqlRunner)=>Promise<T>
):Promise<T>{
 const client=await pool.connect();
 try{
  await client.query('begin');
  const value=await fn((sql,params=[])=>client.query(sql,params));
  await client.query('commit');
  return value;
 }catch(e){await client.query('rollback');throw e}
 finally{client.release()}
}
export async function claimNextDueMessage(){
 return withDispatchTransaction(async run=>{
  // Transaction-scoped advisory lock serializes selection across workers.
  await run("select pg_advisory_xact_lock(792140,681200)");
  await run("insert into goto_send_pacing(scope) values('global') on conflict do nothing");
  const globally=await run("select next_allowed_at from goto_send_pacing where scope='global' for update");
  if(new Date(globally.rows[0].next_allowed_at).getTime()>Date.now())return null;
  const due=await run(
   `select m.id,m.tenant_id
    from scheduled_messages m
    join tenants t on t.id=m.tenant_id and t.status='active'
    left join goto_send_pacing pace on pace.scope=('tenant:'||m.tenant_id::text)
    where m.status='scheduled' and m.scheduled_at<=clock_timestamp()
      and m.next_attempt_at<=clock_timestamp()
      and coalesce(pace.next_allowed_at,'-infinity'::timestamptz)<=clock_timestamp()
      and not exists (
       select 1 from scheduled_messages inflight
       where inflight.tenant_id=m.tenant_id and inflight.status='processing'
      )
    order by m.scheduled_at,m.id
    for update of m skip locked limit 1`
  );
  if(!due.rowCount)return null;
  const msg=due.rows[0];
  const scope='tenant:'+msg.tenant_id;
  await run('insert into goto_send_pacing(scope) values($1) on conflict do nothing',[scope]);
  const pace=await run('select next_allowed_at from goto_send_pacing where scope=$1 for update',[scope]);
  if(new Date(pace.rows[0].next_allowed_at).getTime()>Date.now())return null;
  const now=Date.now();
  const tenantNext=new Date(now+randomTenantDelay());
  const globalNext=new Date(now+GLOBAL_MIN_DELAY_MS);
  await run('update goto_send_pacing set next_allowed_at=$2,updated_at=now() where scope=$1',['global',globalNext]);
  await run('update goto_send_pacing set next_allowed_at=$2,updated_at=now() where scope=$1',[scope,tenantNext]);
  const claimed=await run(
   "update scheduled_messages set status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=$1 and status='scheduled' returning *",
   [msg.id]
  );
  return claimed.rows[0]??null;
 });
}
export async function deferAfterRateLimit(tenantId:string,waitMs:number){
 const next=new Date(Date.now()+Math.min(3600_000,Math.max(30_000,waitMs)));
 await withDispatchTransaction(async run=>{
  await run('select pg_advisory_xact_lock(792140,681200)');
  for(const scope of ['global','tenant:'+tenantId]){
   await run('insert into goto_send_pacing(scope) values($1) on conflict do nothing',[scope]);
   await run('update goto_send_pacing set next_allowed_at=greatest(next_allowed_at,$2),updated_at=now() where scope=$1',[scope,next]);
  }
 });
 return next;
}

export class DispatchPacingError extends Error{
 constructor(public waitMs:number){
  super('Aguarde '+Math.ceil(waitMs/1000)+' segundo(s) antes do próximo teste');
 }
}
/** Reserves a real send while serializing checks/limits with queued sends. */
export async function reserveDirectSend<T>(
 tenantId:string,register:(run:SqlRunner)=>Promise<T>
):Promise<T>{
 return withDispatchTransaction(async run=>{
  await run('select pg_advisory_xact_lock(792140,681200)');
  const scopes=['global','tenant:'+tenantId];
  for(const scope of scopes){
   await run('insert into goto_send_pacing(scope) values($1) on conflict do nothing',[scope]);
  }
  const rows=await run(
   'select scope,next_allowed_at from goto_send_pacing where scope=any($1::text[]) order by scope for update',
   [scopes]
  );
  const waitMs=Math.max(0,...rows.rows.map((r:any)=>
   Math.max(0,new Date(r.next_allowed_at).getTime()-Date.now())||0));
  if(waitMs>0)throw new DispatchPacingError(waitMs);
  const value=await register(run);
  const now=Date.now();
  for(const [scope,delay] of [
   ['global',GLOBAL_MIN_DELAY_MS],
   ['tenant:'+tenantId,randomTenantDelay()]
  ] as const){
   await run('update goto_send_pacing set next_allowed_at=$2,updated_at=now() where scope=$1',
    [scope,new Date(now+delay)]);
  }
  return value;
 });
}
