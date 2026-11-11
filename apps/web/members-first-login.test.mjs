import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const members=readFileSync(new URL('./src/pages/Members.tsx',import.meta.url),'utf8');
const first=readFileSync(new URL('./src/pages/FirstPasswordChange.tsx',import.meta.url),'utf8');
const app=readFileSync(new URL('./src/App.tsx',import.meta.url),'utf8');
const backend=readFileSync(new URL('../api/src/routes.ts',import.meta.url),'utf8');
const auth=readFileSync(new URL('../api/src/auth.ts',import.meta.url),'utf8');

test('new member UI does not call Supabase invite or keep passwords in storage',()=>{
 assert.match(members,/Novo usuário/);
 assert.match(members,/temporary_password/);
 assert.match(members,/reset-password/);
 assert.doesNotMatch(members,/inviteUserByEmail|localStorage|sessionStorage/);
});
test('first-login requires password confirmation and uses protected API endpoint',()=>{
 assert.match(first,/password!==confirmation/);
 assert.match(first,/initial-password/);
 assert.match(first,/signOut\(\)/);
 assert.match(app,/actor\?\.mustChangePassword/);
});
test('API enforces first-password gate independently of the UI',()=>{
 assert.match(auth,/mayAccessDuringPasswordChange/);
 assert.match(auth,/PASSWORD_CHANGE_REQUIRED/);
 assert.match(backend,/\/api\/auth\/initial-password/);
 assert.match(backend,/createTenantMember/);
});

test('existing member multi-tenant grants require explicit confirmation and do not inherit global menus',()=>{
 assert.match(members,/allow_existing_membership/);
 assert.match(members,/Ambiente de destino/);
 assert.match(members,/Contas existentes mantêm a senha atual/);
 assert.match(app,/tenants\.length>1/);
 assert.match(app,/Routes key=\{tenantId\}/);
 assert.match(app,/isSuper&&/);
});
