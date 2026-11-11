import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);

const {pool}=await import('./db.js');

test('idle PostgreSQL ECONNRESET does not crash the API and emits a safe diagnostic',()=>{
 const oldWarn=console.warn;
 const logs:unknown[][]=[];
 console.warn=(...args:unknown[])=>{logs.push(args)};
 try {
  // node-postgres emits this event on the Pool when an idle connection fails.
  const error=Object.assign(new Error('read ECONNRESET; password=do-not-log'),{code:'ECONNRESET'});
  assert.doesNotThrow(()=>pool.emit('error',error));
  assert.equal(logs.length,1);
  const output=JSON.stringify(logs[0]);
  assert.match(output,/ECONNRESET/);
  assert.match(output,/Conexão ociosa interrompida/);
  assert.doesNotMatch(output,/do-not-log|password=|postgresql:\/\//);
 } finally {
  console.warn=oldWarn;
 }
});

test('idle pool errors without a valid code are logged without their raw message or client',()=>{
 const oldWarn=console.warn;
 const logs:unknown[][]=[];
 console.warn=(...args:unknown[])=>{logs.push(args)};
 try {
  assert.doesNotThrow(()=>pool.emit('error',new Error('private database credentials')));
  assert.match(JSON.stringify(logs),/UNKNOWN/);
  assert.doesNotMatch(JSON.stringify(logs),/private database credentials/);
 } finally {
  console.warn=oldWarn;
 }
});
