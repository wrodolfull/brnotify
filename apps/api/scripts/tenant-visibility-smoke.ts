import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const db=process.env.CI_DATABASE_URL;
if(!db||!db.includes('127.0.0.1'))
 throw new Error('Use somente banco de testes PostgreSQL local');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=db;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {listVisibleTenants,listTenantOptions}=await import('../src/tenant-list.js');
try{
 const id=crypto.randomUUID();
 const superId=crypto.randomUUID();
 const memberId=crypto.randomUUID();
 const otherId=crypto.randomUUID();
 const prefix='visibility-ci-'+id.slice(0,8);

 for(const [userId,email] of [
  [superId,'super.'+prefix+'@example.test'],
  [memberId,'member.'+prefix+'@example.test'],
  [otherId,'other.'+prefix+'@example.test']
 ]){
  await query('insert into auth.users(id,email) values($1,$2)',[userId,email]);
 }
 const first=await query("select id from tenants where slug='teste-ci'");
 assert.ok(first.rowCount,'db-smoke deve criar o ambiente base teste-ci');
 const firstId=first.rows[0].id as string;
 const second=await query(
  "insert into tenants(name,slug,segment) values('Second tenant',$1,'clinic') returning id",
  [prefix+'-second']
 );
 const secondId=second.rows[0].id as string;
 await query(
  "insert into tenant_members(tenant_id,user_id,email,role) values($1,$2,$3,'viewer')",
  [firstId,memberId,'member.'+prefix+'@example.test']
 );
 await query(
  "insert into tenant_members(tenant_id,user_id,email,role) values($1,$2,$3,'admin')",
  [secondId,otherId,'other.'+prefix+'@example.test']
 );

 // Admin has no tenant membership, but must see every organization.
 const superActor={id:superId,superAdmin:true};
 const adminPage=await listVisibleTenants(superActor,1);
 assert.ok(adminPage.items.some((x:any)=>x.id===firstId),'Super Admin não vê o primeiro ambiente');
 assert.ok(adminPage.items.some((x:any)=>x.id===secondId),'Super Admin não vê o segundo ambiente');
 assert.ok(adminPage.items.every((x:any)=>x.role==='admin'),'Super Admin precisa de papel administrativo');
 assert.ok(adminPage.total>=2);

 // Members must never see another organization's name or metadata.
 const memberActor={id:memberId,superAdmin:false};
 const memberPage=await listVisibleTenants(memberActor,1);
 assert.equal(memberPage.total,1,'Membro viu ambientes não autorizados');
 assert.deepEqual(memberPage.items.map((x:any)=>x.id),[firstId]);
 assert.equal(memberPage.items[0].role,'viewer');
 assert.equal(memberPage.pages,1);
 const memberOptions=await listTenantOptions(memberActor);
 assert.deepEqual(memberOptions.items.map((x:any)=>x.id),[firstId]);

 const other=await listVisibleTenants({id:otherId,superAdmin:false},1);
 assert.deepEqual(other.items.map((x:any)=>x.id),[secondId]);

 // Even an authenticated user not provisioned for any tenant must see no data.
 const unlinked=await listVisibleTenants({id:crypto.randomUUID(),superAdmin:false},1);
 assert.equal(unlinked.total,0);
 assert.deepEqual(unlinked.items,[]);

 // Stress the page boundary: navbar options still include ALL authorized tenants.
 const extra=53;
 for(let i=0;i<extra;i++){
  await query(
   "insert into tenants(name,slug,segment) values($1,$2,'custom')",
   ['Tenant pagination '+i,prefix+'-extra-'+i]
  );
 }
 const firstPage=await listVisibleTenants(superActor,1);
 const secondPage=await listVisibleTenants(superActor,2);
 assert.equal(firstPage.items.length,50);
 assert.ok(secondPage.items.length>=5);
 assert.equal(firstPage.total,extra+2); // two fixture environments + 53 extra
 assert.equal(firstPage.pages,2);
 const allOptions=await listTenantOptions(superActor);
 assert.equal(allOptions.items.length,extra+2);
 assert.ok(allOptions.items.some((x:any)=>x.id===firstId));
 assert.ok(allOptions.items.some((x:any)=>x.id===secondId));
 const stillPrivate=await listVisibleTenants(memberActor,1);
 assert.equal(stillPrivate.total,1);

 console.log('Tenant visibility: Super Admin, membership access, privacy, paging and all-options approved');
}finally{
 await pool.end();
}
