import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isOnDemandKeyValid} from './on-demand-key-policy.js';

const now=Date.UTC(2026,10,11,15,0,0);
const base={source:'api',api_key_id:'key-1',token_revoked_at:null,token_expires_at:null};

test('permanent URA token is accepted by the asynchronous dispatch worker',()=>{
 assert.equal(isOnDemandKeyValid(base,now),true);
});
test('expiry/revocation and missing keys still block sending',()=>{
 assert.equal(isOnDemandKeyValid({...base,token_expires_at:new Date(now+60_000)},now),true);
 assert.equal(isOnDemandKeyValid({...base,token_expires_at:new Date(now-1)},now),false);
 assert.equal(isOnDemandKeyValid({...base,token_expires_at:undefined},now),false);
 assert.equal(isOnDemandKeyValid({...base,token_expires_at:'invalid'},now),false);
 assert.equal(isOnDemandKeyValid({...base,token_revoked_at:new Date(now-100)},now),false);
 assert.equal(isOnDemandKeyValid({...base,api_key_id:null},now),false);
});
test('panel and automation messages do not require an integration API key',()=>{
 for(const source of ['panel','automation'])
  assert.equal(isOnDemandKeyValid({source,api_key_id:null,token_revoked_at:null,token_expires_at:null},now),true);
});
