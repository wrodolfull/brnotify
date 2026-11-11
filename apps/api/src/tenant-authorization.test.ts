import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tenantRoleFor,tenantPermitted} from './tenant-authorization.js';
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const C='00000000-0000-4000-8000-000000000003';

test('tenant admin is not a platform super admin and cannot switch tenants with a forged x-tenant-id',()=>{
 const actor={superAdmin:false,memberships:[{tenant_id:A,role:'admin' as const}]};
 assert.equal(tenantRoleFor(actor,A),'admin');
 assert.equal(tenantPermitted(actor,A,true),true);
 for(const other of [B,C]){
  assert.equal(tenantRoleFor(actor,other),null);
  assert.equal(tenantPermitted(actor,other,false),false);
  assert.equal(tenantPermitted(actor,other,true),false);
 }
});

test('viewer can read only its tenant; cannot write',()=>{
 const actor={superAdmin:false,memberships:[{tenant_id:A,role:'viewer' as const}]};
 assert.equal(tenantPermitted(actor,A,false),true);
 assert.equal(tenantPermitted(actor,A,true),false);
 assert.equal(tenantPermitted(actor,B,false),false);
});

test('global access is reserved for explicit platform_admins membership',()=>{
 const actor={superAdmin:true,memberships:[]};
 assert.equal(tenantPermitted(actor,A,true),true);
 assert.equal(tenantPermitted(actor,B,true),true);
 assert.equal(tenantPermitted(null,A,false),false);
});

test('an unknown tenant role never inherits admin rights',()=>{
 const actor={superAdmin:false,memberships:[{tenant_id:A,role:'superadmin' as 'admin'}]};
 assert.equal(tenantRoleFor(actor,A),null);
 assert.equal(tenantPermitted(actor,A,true),false);
});
