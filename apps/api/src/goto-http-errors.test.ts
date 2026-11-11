import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {gotoOperation,describeGotoHttpFailure}=await import('./goto.js');

test('cloudfront HTML refusal identifies notification channel stage without copying HTML',()=>{
 const html='<!DOCTYPE HTML><HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD>'+
  '<BODY>Authorization: Bearer super-private-token</BODY></HTML>';
 const failure=describeGotoHttpFailure('POST',
  '/notification-channel/v1/channels/brnotify-tenant-random',403,'text/html; charset=iso-8859-1',html,
  'ABCD1234xyz==');
 assert.match(failure,/GoTo HTTP 403 ao criar canal de notificações/);
 assert.match(failure,/Resposta HTML do gateway\/CDN/);
 assert.match(failure,/ABCD1234xyz==/);
 assert.doesNotMatch(failure,/Bearer|super-private|DOCTYPE|<HTML>/);
});
test('reports scope error is parsed as JSON and never leaks the original body',()=>{
 const failure=describeGotoHttpFailure('POST','/call-events-report/v1/subscriptions',
  403,'application/json',JSON.stringify({
   errorCode:'AUTHZ_INSUFFICIENT_SCOPE',message:'secret: token-value'
  }));
 assert.match(failure,/assinar relatórios de chamadas/);
 assert.match(failure,/AUTHZ_INSUFFICIENT_SCOPE/);
 assert.doesNotMatch(failure,/secret:|token-value/);
});
test('states subscription and report fetch are distinguished',()=>{
 assert.equal(gotoOperation('POST','/call-events/v1/subscriptions'),'assinar eventos de telefonia');
 assert.equal(gotoOperation('POST','/call-events-report/v1/subscriptions'),'assinar relatórios de chamadas');
 assert.equal(gotoOperation('GET','/call-events-report/v1/reports/uuid'),'consultar relatório de chamadas');
});
test('malformed CDN ID, JSON message, and query strings are never reflected',()=>{
 const fail=describeGotoHttpFailure('GET','/messaging/v2/accounts/123/message-templates?ownerTouchpoint=SECRET',
  403,'application/json','{"message":"Bearer SECRET","errorCode":"INVALID TOKEN"}','abc\\r\\nAuthorization: key');
 assert.match(fail,/sincronizar templates WhatsApp/);
 assert.doesNotMatch(fail,/SECRET|Authorization|INVALID TOKEN/);
});
