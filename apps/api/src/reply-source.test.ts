import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {resolveRecentReplySource}=await import('./reply-source.js');

const id='11111111-1111-4111-8111-111111111111';
const at='2026-11-12T14:00:00.000Z';
function client(rows:unknown[]){return {query:async (sql:string,params:unknown[])=>{
 assert.match(sql,/interval '7 days'/);
 assert.equal(params[0],id);
 assert.equal(params[1],'+5511991234567');
 assert.equal(params[2],at);
 assert.match(String(params[3]),/^[a-f0-9]{64}$/);
 return {rows};
}} as any}
test('attributes a reply only to one accepted outbound template',async()=>{
 assert.deepEqual(await resolveRecentReplySource(client([{kind:'panel',template_id:'tpl-1',id:'message-1'}]),id,'11991234567',at),
  {kind:'panel',templateId:'tpl-1',messageId:'message-1'});
 assert.deepEqual(await resolveRecentReplySource(client([{kind:'reminder',template_id:'tpl-2',id:'message-2'}]),id,'11991234567',at),
  {kind:'reminder',templateId:'tpl-2',messageId:'message-2'});
 assert.deepEqual(await resolveRecentReplySource(client([{kind:'test',template_id:'tpl-3',id:'test-1'}]),id,'11991234567',at),
  {kind:'test',templateId:'tpl-3',messageId:'test-1'});
});
test('fails closed on missing or ambiguous message history',async()=>{
 assert.equal(await resolveRecentReplySource(client([]),id,'11991234567',at),null);
 assert.equal(await resolveRecentReplySource(client([
  {kind:'panel',template_id:'tpl-1',id:'message-1'},
  {kind:'reminder',template_id:'tpl-2',id:'message-2'}
 ]),id,'11991234567',at),null);
 assert.equal(await resolveRecentReplySource(client([]),id,'invalid-phone',at),null);
 assert.equal(await resolveRecentReplySource(client([]),id,'11991234567','invalid-date'),null);
});
