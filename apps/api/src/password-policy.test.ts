import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FORCE_PASSWORD_CHANGE,needsPasswordChange,mayAccessDuringPasswordChange} from './password-policy.js';

test('only server-owned app metadata requires a first-login password change',()=>{
 assert.equal(needsPasswordChange({[FORCE_PASSWORD_CHANGE]:true}),true);
 assert.equal(needsPasswordChange({[FORCE_PASSWORD_CHANGE]:false}),false);
 assert.equal(needsPasswordChange({}),false);
 assert.equal(needsPasswordChange(null),false);
});
test('password-change gate permits only bootstrap endpoints',()=>{
 for(const path of ['/api/me','/api/tenant-options','/api/auth/initial-password'])
  assert.equal(mayAccessDuringPasswordChange(path),true);
 for(const path of ['/api/members','/api/contacts','/api/goto','/api/reports','/v1/messages/send'])
  assert.equal(mayAccessDuringPasswordChange(path),false);
});
