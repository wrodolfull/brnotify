import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY ||= '0'.repeat(64);
const keys=await import('./integration-keys.js');
const outbound=await import('./outbound-webhooks.js');
const confirmation=await import('./confirmation.js');
const operations=await import('./external-operations.js');

test('API keys are long, unique, hashed, and scoped',()=>{
 const a=keys.generateApiKey(),b=keys.generateApiKey();
 assert.match(a.token,/^brn_live_[a-f0-9]{64}$/);
 assert.notEqual(a.token,b.token);
 assert.equal(keys.hashApiKey(a.token),a.hash);
 assert.notEqual(a.hash,a.token);
 assert.ok(keys.hasScope(['events:write'],'events:write'));
 assert.equal(keys.hasScope(['events:read'],'events:write'),false);
});
test('unsafe webhook URLs are rejected before DNS lookup',()=>{
 for(const url of [
  'http://example.com/hook','https://127.0.0.1/hook','https://localhost/hook',
  'https://internal.local/hook','https://example.com:8080/hook',
  'https://user:pass@example.com','https://example.com/path#fragment'
 ])assert.throws(()=>outbound.parseWebhookUrl(url));
 assert.equal(outbound.parseWebhookUrl('https://hooks.example.com/v1/receive').hostname,'hooks.example.com');
});
test('public IP policy excludes internal, link-local and metadata networks',()=>{
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.0.1','172.16.0.1','100.64.0.1'])
  assert.equal(outbound.isSafePublicAddress(address,4),false,address);
 assert.equal(outbound.isSafePublicAddress('8.8.8.8',4),true);
 assert.equal(outbound.isSafePublicAddress('::1',6),false);
 assert.equal(outbound.isSafePublicAddress('2001:4860:4860::8888',6),true);
});
test('HMAC signature is deterministic but changes when body or secret changes',()=>{
 const signature=outbound.signWebhook('secret','123','{"id":"a"}');
 assert.match(signature,/^sha256=[a-f0-9]{64}$/);
 assert.equal(signature,outbound.signWebhook('secret','123','{"id":"a"}'));
 assert.notEqual(signature,outbound.signWebhook('secret','123','{"id":"b"}'));
 assert.notEqual(signature,outbound.signWebhook('wrong','123','{"id":"a"}'));
});
test('inbound confirmation text requires unambiguous opt-in word',()=>{
 assert.equal(confirmation.classifyConfirmation('sim'),'confirmed');
 assert.equal(confirmation.classifyConfirmation('CONFIRMAR!'),'confirmed');
 assert.equal(confirmation.classifyConfirmation('remarcar'),'reschedule_requested');
 assert.equal(confirmation.classifyConfirmation('CANCELAR AGENDAMENTO'),'declined');
 assert.equal(confirmation.classifyConfirmation('Bom dia, obrigado'),null);
});
test('explicit empty reminder list disables all three; three custom intervals are respected',()=>{
 const a=operations.offsetOverrides([]);
 assert.deepEqual(Object.values(a||{}),[{enabled:false},{enabled:false},{enabled:false}]);
 const custom=operations.offsetOverrides([
  {before:30,unit:'days',enabled:true},
  {before:3,unit:'days',enabled:true},
  {before:1,unit:'days',enabled:true}
 ]);
 assert.equal((custom?.['2'] as any).offset_value,3);
 assert.equal((custom?.['2'] as any).offset_unit,'days');
 assert.equal((custom?.['3'] as any).offset_value,1);
});
test('validation rejects extra unexpected business payloads',()=>{
 const good={
  external_id:'REV-2026-1045',
  contact:{name:'Carlos',phone:'+5519999999999',consent:true,consent_source:'CRM'},
  event:{title:'Revisão',date:'2026-12-15',time:'09:00'}
 };
 assert.ok(operations.reminderPayloadSchema.safeParse(good).success);
 assert.equal(operations.reminderPayloadSchema.safeParse({...good,tenant_id:'other-tenant'}).success,false);
 assert.equal(operations.reminderPayloadSchema.safeParse({...good,reminders:[{before:1,unit:'days'},{before:2,unit:'days'},{before:3,unit:'days'},{before:4,unit:'days'}]}).success,false);
});
