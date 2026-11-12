import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {resolveRecentReplySource,resolveFlowTemplateSource}=await import('./reply-source.js');

const id='11111111-1111-4111-8111-111111111111';
const at='2026-11-12T14:00:00.000Z';
function client(rows:unknown[]){return {query:async (sql:string,params:unknown[])=>{
 assert.match(sql,/interval '7 days'/);
 assert.equal(params[0],id);
 assert.equal(params[1],'+5511991234567');
 assert.equal(params[2],at);
 return {rows};
}} as any}
test('attributes a reply only to one accepted outbound template',async()=>{
 assert.deepEqual(await resolveRecentReplySource(client([{kind:'panel',template_id:'tpl-1',id:'message-1'}]),id,'11991234567',at),
  {kind:'panel',templateId:'tpl-1',messageId:'message-1'});
 assert.deepEqual(await resolveRecentReplySource(client([{kind:'reminder',template_id:'tpl-2',id:'message-2'}]),id,'11991234567',at),
  {kind:'reminder',templateId:'tpl-2',messageId:'message-2'});
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

const {diagnoseUnmatchedReply}=await import('./reply-source.js');
function workflowClient(rows:unknown[]){
 return {query:async (sql:string,params:unknown[])=>{
  assert.match(sql,/group by template_id limit 2/);
  assert.equal(params[0],id);assert.equal(params[1],'+5511991234567');assert.equal(params[2],at);
  return {rows,rowCount:rows.length};
 }} as any;
}
test('multiple accepted URA sends from the same template can trigger its workflow',async()=>{
 assert.deepEqual(await resolveFlowTemplateSource(workflowClient([
  {template_id:'template-a',send_count:2,message_id:null}
 ]),id,'11991234567',at),{templateId:'template-a',messageId:null,sendCount:2});
 assert.deepEqual(await resolveFlowTemplateSource(workflowClient([
  {template_id:'template-a',send_count:1,message_id:'message-1'}
 ]),id,'11991234567',at),{templateId:'template-a',messageId:'message-1',sendCount:1});
});
test('workflows never guess between different templates or missing template references',async()=>{
 assert.equal(await resolveFlowTemplateSource(workflowClient([
  {template_id:'template-a',send_count:2,message_id:null},
  {template_id:'template-b',send_count:1,message_id:'message-3'}
 ]),id,'11991234567',at),null);
 assert.equal(await resolveFlowTemplateSource(workflowClient([{template_id:null,send_count:1,message_id:'message-1'}]),id,'11991234567',at),null);
 assert.equal(await resolveFlowTemplateSource(workflowClient([]),id,'11991234567',at),null);
});

function diagnosticClient(candidateRows:unknown[],historyRows:unknown[]=[]){
 let count=0;
 return {query:async (sql:string)=>{
  count++;
  if(count===1){assert.match(sql,/group by template_id limit 2/);return {rows:candidateRows,rowCount:candidateRows.length}}
  assert.match(sql,/from on_demand_messages where tenant_id=\$1 and recipient_phone=\$2/);
  return {rows:historyRows,rowCount:historyRows.length}
 }} as any;
}
test('distinguishes ambiguous URA sends from missing messages',async()=>{
 const ambiguous=await diagnoseUnmatchedReply(diagnosticClient([
  {template_id:'tpl-a',send_count:1,message_id:'a'},
  {template_id:'tpl-b',send_count:1,message_id:'b'}
 ]),id,'11991234567',at);
 assert.match(ambiguous,/dois ou mais templates diferentes/);
 const missing=await diagnoseUnmatchedReply(diagnosticClient([]),id,'11991234567',at);
 assert.match(missing,/Não foi encontrado disparo da URA/);
});
test('explains pending sends, invalid WhatsApp identity and mismatched timestamps',async()=>{
 const pending=await diagnoseUnmatchedReply(diagnosticClient([],[{status:'queued',sent_at:null,provider_message_id:null}]),
  id,'11991234567',at);
 assert.match(pending,/fila ou em processamento/);
 const future=await diagnoseUnmatchedReply(diagnosticClient([],[{status:'sent',sent_at:'2026-11-12T16:00:00Z',provider_message_id:'msg'}]),
  id,'11991234567',at);
 assert.match(future,/posterior ao horário informado/);
 assert.match(await diagnoseUnmatchedReply(diagnosticClient([]),id,'invalid-phone',at),/não pode ser interpretado/);
});
