import assert from 'node:assert/strict';
import crypto from 'node:crypto';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))throw Error('Somente banco PostgreSQL de CI');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {query,pool}=await import('../src/db.js');
const {hashApiKey,generateApiKey}=await import('../src/integration-keys.js');
const {apiKeyCreationSchema}=await import('../src/api-key-lifetime.js');
try{
 const row=await query("select id from tenants where slug='teste-ci'");
 assert.equal(row.rowCount,1);
 const tenantId=row.rows[0].id;
 const token=generateApiKey();
 const forever=apiKeyCreationSchema.parse({label:'URA test',scopes:['messages:send'],expires_in_days:null});
 const created=await query(
  'insert into integration_api_keys(tenant_id,label,token_prefix,token_hash,scopes,expires_at) values($1,$2,$3,$4,$5,$6) returning id,expires_at',
  [tenantId,forever.label,token.prefix,token.hash,forever.scopes,forever.expires_in_days]
 );
 assert.equal(created.rows[0].expires_at,null);
 const auth=await query(
  "select k.id from integration_api_keys k join tenants t on t.id=k.tenant_id where k.token_hash=$1 and k.revoked_at is null and (k.expires_at is null or k.expires_at>now()) and t.status='active'",
  [hashApiKey(token.token)]
 );
 assert.equal(auth.rowCount,1,'Token sem expiração precisa autenticar');
 const count=await query(
  'select count(*)::int n from integration_api_keys where tenant_id=$1 and revoked_at is null and (expires_at is null or expires_at>now())',
  [tenantId]
 );
 assert.ok(count.rows[0].n>=1,'Token sem expiração precisa contar como ativo');
 await assert.rejects(
  query(
   "insert into integration_api_keys(tenant_id,label,token_prefix,token_hash,scopes,expires_at) values($1,'Inseguro',$2,$3,ARRAY['contacts:read'],null)",
   [tenantId,'test-broad-'+crypto.randomUUID().slice(0,8),crypto.randomBytes(32).toString('hex')]
  ),
  /integration_api_keys_nonexpiring_ura_only/
 );
 const expiry=await query(
  "insert into integration_api_keys(tenant_id,label,token_prefix,token_hash,scopes,expires_at) values($1,'Expirado',$2,$3,ARRAY['messages:send'],now()-interval '1 day') returning id",
  [tenantId,'test-old-'+crypto.randomUUID().slice(0,8),crypto.randomBytes(32).toString('hex')]
 );
 const blocked=await query(
  "select id from integration_api_keys where id=$1 and revoked_at is null and (expires_at is null or expires_at>now())",[expiry.rows[0].id]
 );
 assert.equal(blocked.rowCount,0,'Token expirado não deve autenticar');
 await query('update integration_api_keys set revoked_at=now() where id=$1',[created.rows[0].id]);
 const revoked=await query(
  "select id from integration_api_keys where id=$1 and revoked_at is null and (expires_at is null or expires_at>now())",[created.rows[0].id]
 );
 assert.equal(revoked.rowCount,0,'Revogação bloqueia token permanente imediatamente');
 console.log('URA token: no expiry, authentication, active count, DB constraint, expiration and revocation OK');
}finally{await pool.end()}
