import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attemptAutomaticTemplateSync} from './goto-auto-sync.js';
test('syncs right after setting account and phone ID',async()=>{
 let called=0;
 const outcome=await attemptAutomaticTemplateSync(async()=>{called++;return 4});
 assert.deepEqual(outcome,{status:'success',count:4});assert.equal(called,1);
});
test('no templates is a valid successful result',async()=>{
 assert.deepEqual(await attemptAutomaticTemplateSync(async()=>0),{status:'success',count:0});
});
test('GoTo errors never leak sensitive response details to the user',async()=>{
 const denied=await attemptAutomaticTemplateSync(async()=>{throw Error('GoTo HTTP 403: token=secret&accountKey=confidential')});
 assert.equal(denied.status,'error');assert.match(denied.message,/403/);assert.doesNotMatch(denied.message,/secret|confidential/);
 const expired=await attemptAutomaticTemplateSync(async()=>{throw Error('GoTo HTTP 401: Bearer private-token')});
 assert.match(expired.message,/Reconecte/);assert.doesNotMatch(expired.message,/private-token/);
});
test('rate-limited and network failures are handled without throwing',async()=>{
 const limited=await attemptAutomaticTemplateSync(async()=>{throw Error('GoTo HTTP 429')});
 assert.equal(limited.status,'error');assert.match(limited.message,/429/);
 const network=await attemptAutomaticTemplateSync(async()=>{throw Error('fetch failed: internal-host')});
 assert.equal(network.status,'error');assert.doesNotMatch(network.message,/internal-host/);
});
