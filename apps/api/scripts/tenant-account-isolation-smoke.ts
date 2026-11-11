import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const db=process.env.CI_DATABASE_URL;
if(!db||!db.includes('127.0.0.1'))throw new Error('Use somente banco local de CI');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=db;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {createTenantMember}=await import('../src/member-accounts.js');
const {tenantPermitted}=await import('../src/tenant-authorization.js');
try{
 const suffix=crypto.randomUUID().slice(0,8);
 const first=(await query("select id from tenants where slug='teste-ci'")).rows[0]?.id as string;
 assert.ok(first,'CI database must contain teste-ci');
 const second=(await query("insert into tenants(name,slug,segment) values($1,$2,'custom') returning id",
  ['Tenant isolated '+suffix,'security-isolation-'+suffix])).rows[0].id as string;
 const owner=crypto.randomUUID(),admin=crypto.randomUUID(),superUser=crypto.randomUUID();
 const adminEmail='company-admin-'+suffix+'@example.test';
 const superEmail='platform-owner-'+suffix+'@example.test';
 for(const [id,email] of [[owner,'owner-'+suffix+'@example.test'],[admin,adminEmail],[superUser,superEmail]]){
  await query('insert into auth.users(id,email) values($1,$2)',[id,email]);
 }
 await query('insert into platform_admins(user_id) values($1)',[superUser]);
 await query("insert into tenant_members(tenant_id,user_id,email,role) values($1,$2,$3,'admin')",[first,admin,adminEmail]);

 const ordinary={superAdmin:false,memberships:[{tenant_id:first,role:'admin' as const}]};
 assert.equal(tenantPermitted(ordinary,first,true),true);
 assert.equal(tenantPermitted(ordinary,second,false),false);
 assert.equal(tenantPermitted(ordinary,second,true),false);

 await assert.rejects(
  createTenantMember(second,owner,{name:'Admin Teste',email:adminEmail,role:'admin'}),
  /outra empresa/
 );
 await assert.rejects(
  createTenantMember(second,owner,{name:'Super Teste',email:superEmail,role:'admin'}),
  /Super Admin/
 );
 assert.equal((await query('select count(*)::int n from tenant_members where tenant_id=$1',[second])).rows[0].n,0);

 const same=await createTenantMember(first,owner,{name:'Admin Teste',email:adminEmail,role:'viewer'});
 assert.equal(same.created,false);
 assert.equal(same.temporary_password,null);
 assert.equal((await query('select role from tenant_members where user_id=$1 and tenant_id=$2',[admin,first])).rows[0].role,'viewer');
 console.log('Isolamento de contas: admin de tenant sem acesso global, vínculo cruzado e Super Admin reutilizado bloqueados');
}finally{await pool.end();}
