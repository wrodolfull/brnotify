import assert from 'node:assert/strict';
import {DateTime} from 'luxon';

const database=process.env.CI_DATABASE_URL;
if(!database||!database.includes('127.0.0.1'))
 throw new Error('O teste deve usar somente o PostgreSQL local do CI');
process.env.NODE_ENV='test';
process.env.DATABASE_URL=database;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder-test-key';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);

const {query,pool}=await import('../src/db.js');
const {loadDashboardTrend}=await import('../src/dashboard-trend.js');

try{
 const tenant=await query("select id,timezone from tenants where slug='teste-ci'");
 assert.equal(tenant.rowCount,1,'Ambiente teste-ci não criado pelo db-smoke');
 const {id,timezone}=tenant.rows[0];

 // This executes precisely the SQL used by GET /api/dashboard.
 const response=await loadDashboardTrend(id);
 assert.equal(response.rowCount,14,'Gráfico deve mostrar 14 dias inclusive sem mensagens');
 assert.equal(response.rows.length,14);
 const expectedDays=Array.from({length:14},(_,i)=>
  DateTime.now().setZone(timezone).minus({days:13-i}).toISODate()
 );
 assert.deepEqual(response.rows.map(r=>r.day),expectedDays);
 for(const row of response.rows){
  assert.match(row.day,/^\d{4}-\d{2}-\d{2}$/);
  for(const value of ['sent','delivered','failed']){
   assert.equal(typeof row[value],'number',value+' deve ser numérico');
   assert.ok(row[value]>=0,value+' não deve ser negativo');
  }
 }
 // A nonexistent tenant should not be allowed to read another tenant's trend.
 const missing=await loadDashboardTrend('00000000-0000-4000-8000-000000000000');
 assert.equal(missing.rows.length,0,'Consulta de outro tenant vazou dados');
 console.log('Dashboard: SQL válido, 14 dias locais, métricas e isolamento testados');
}finally{
 await pool.end();
}
