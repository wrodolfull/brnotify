import assert from 'node:assert/strict';
const db=process.env.CI_DATABASE_URL;
if(!db||!db.includes('127.0.0.1'))throw new Error('Use somente banco CI local');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=db;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {query,pool}=await import('../src/db.js');
const {claimNextDueMessage,deferAfterRateLimit,GLOBAL_MIN_DELAY_MS}=await import('../src/send-pacing.js');
try{
 const tenant=await query("select id from tenants where slug='teste-ci'");
 assert.ok(tenant.rowCount,'Ambiente fixture inexistente');
 const tenantId=tenant.rows[0].id;
 const event=await query("select id from events where tenant_id=$1 and external_id='REV-CI-1'",[tenantId]);
 assert.ok(event.rowCount,'Evento fixture inexistente');
 const first=await query(
  "insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,attempt_count,schedule_revision,next_attempt_at) values($1,$2,2,now()-interval '2 minutes',0,1,now()-interval '2 minutes') returning id,scheduled_at",
  [tenantId,event.rows[0].id]
 );
 const second=await query(
  "insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,attempt_count,schedule_revision,next_attempt_at) values($1,$2,3,now()-interval '1 minute',0,1,now()-interval '1 minute') returning id,scheduled_at",
  [tenantId,event.rows[0].id]
 );
 const started=Date.now();
 // Two separate pooled clients race for the same global reservation.
 const claims=await Promise.all([claimNextDueMessage(),claimNextDueMessage()]);
 const nonempty=claims.filter(Boolean);
 assert.equal(nonempty.length,1,'Duas instâncias reservaram o mesmo intervalo');
 assert.equal(nonempty[0]?.id,first.rows[0].id,'FIFO por data original violado');
 const state=await query('select status,attempt_count,scheduled_at,next_attempt_at from scheduled_messages where id=$1',[first.rows[0].id]);
 assert.equal(state.rows[0].status,'processing');
 assert.equal(state.rows[0].attempt_count,1);
 assert.equal(new Date(state.rows[0].scheduled_at).getTime(),new Date(first.rows[0].scheduled_at).getTime());
 const pacing=await query("select scope,next_allowed_at from goto_send_pacing where scope in ('global',$1)",['tenant:'+tenantId]);
 assert.equal(pacing.rowCount,2);
 const allowed=new Map(pacing.rows.map(x=>[x.scope,new Date(x.next_allowed_at).getTime()]));
 assert.ok(allowed.get('global')-started>=GLOBAL_MIN_DELAY_MS-100,'Global throttle insuficiente');
 assert.ok(allowed.get('tenant:'+tenantId)-started>=900,'Sem atraso aleatório por tenant');
 assert.ok(allowed.get('tenant:'+tenantId)-started<=5700,'Atraso por tenant fora da faixa');
 const untouched=await query('select status,scheduled_at from scheduled_messages where id=$1',[second.rows[0].id]);
 assert.equal(untouched.rows[0].status,'scheduled');
 assert.equal(new Date(untouched.rows[0].scheduled_at).getTime(),new Date(second.rows[0].scheduled_at).getTime());
 await query("update scheduled_messages set status='sent',sent_at=now(),locked_at=null where id=$1",[first.rows[0].id]);
 const paused=await deferAfterRateLimit(tenantId,31_000);
 assert.ok(paused.getTime()>Date.now()+29_000);
 assert.equal(await claimNextDueMessage(),null,'429 global cooldown não bloqueou o próximo envio');
 console.log('Pacing: concorrência, FIFO, 1–5s por tenant, teto global, cooldown e data original aprovados');
}finally{await pool.end()}
