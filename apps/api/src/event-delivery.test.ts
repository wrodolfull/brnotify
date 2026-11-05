import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='placeholder-key';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {planEventDelivery}=await import('./time.js');

const now=Date.parse('2026-11-05T15:00:00Z');
const start=new Date(now+2*60*60_000);
const due=new Date(now+5*60_000);
const template={id:'11111111-1111-4111-8111-111111111111',name:'Lembrete aprovado',status:'APPROVED'};
const base={
 starts_at:start,timezone:'America/Sao_Paulo',status:'scheduled',consent:true,
 opted_out_at:null,delivery_mode:'custom' as const,
 custom_send_at:due,custom_template_id:template.id
};
const rule={slot:1,enabled:true,offset_value:1,offset_unit:'days' as const,send_time:'09:00:00',template_id:template.id,template_status:'APPROVED',template_name:template.name};
test('custom reminder uses the exact date and template, not the automation offset',()=>{
 const plan=planEventDelivery(base,[rule],template,now);
 assert.equal(plan.can_schedule,true);
 assert.equal(plan.reminders.length,1);
 assert.equal(plan.reminders[0].slot,1);
 assert.equal(plan.reminders[0].scheduled_at,due.toISOString());
 assert.equal(plan.reminders[0].template_id,template.id);
});
test('automation honors configured rule times, not an arbitrary event start',()=>{
 const futureStart=new Date(now+10*86400000);
 const plan=planEventDelivery({...base,starts_at:futureStart,delivery_mode:'automation'},[rule],template,now);
 assert.equal(plan.reminders.length,1);
 assert.equal(plan.reminders[0].scheduled_at,'2026-11-14T12:00:00.000Z');
});
test('custom dispatch rejects past, late, unauthorized or unapproved notifications',()=>{
 for(const [context,reason] of [
  [{custom_send_at:new Date(now+1000)},/30 segundos/],
  [{custom_send_at:new Date(now+5*60*60_000)},/antes do horário/],
  [{consent:false},/não autorizou/],
  [{opted_out_at:new Date(now-1000)},/não autorizou/],
  [{starts_at:new Date(now-1000)},/futuro/]
 ] as const){
  const plan=planEventDelivery({...base,...context},[],template,now);
  assert.equal(plan.can_schedule,false,reason.toString());
  assert.ok(plan.warnings.some(w=>reason.test(w)),reason.toString());
 }
 assert.equal(planEventDelivery(base,[],{...template,status:'PENDING'},now).reminders.length,0);
 assert.equal(planEventDelivery(base,[],null,now).reminders.length,0);
});
test('automatic mode explains past rules and blocks missing templates',()=>{
 const past=planEventDelivery({...base,delivery_mode:'automation'},[rule],null,now);
 assert.equal(past.can_schedule,false);
 assert.match(past.warnings.join(' '),/passou/);
 const withoutTemplate=planEventDelivery({...base,delivery_mode:'automation'},[{...rule,template_id:null,template_status:null}],null,now);
 assert.equal(withoutTemplate.can_schedule,false);
 assert.match(withoutTemplate.warnings.join(' '),/template aprovado/);
});
test('an override cannot inject a template from another tenant',()=>{
 const future=new Date(now+10*86400000);
 const plan=planEventDelivery({...base,starts_at:future,delivery_mode:'automation',
  reminder_overrides:{'1':{template_id:'22222222-2222-4222-8222-222222222222'}}},
  [rule],null,now);
 assert.equal(plan.reminders[0].template_id,template.id);
});
