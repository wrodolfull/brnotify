import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {apiKeyCreationSchema}=await import('./api-key-lifetime.js');

test('URA-only key can explicitly never expire',()=>{
 const result=apiKeyCreationSchema.parse({label:'URA GoTo',scopes:['messages:send'],expires_in_days:null});
 assert.equal(result.expires_in_days,null);
});
test('legacy keys default to 90 days and short-lived keys still work',()=>{
 const base={label:'CRM',scopes:['contacts:read']};
 assert.equal(apiKeyCreationSchema.parse(base).expires_in_days,90);
 assert.equal(apiKeyCreationSchema.parse({...base,expires_in_days:30}).expires_in_days,30);
 assert.equal(apiKeyCreationSchema.parse({...base,expires_in_days:365}).expires_in_days,365);
});
test('never-expiring keys cannot have broad permissions',()=>{
 for(const scopes of [['contacts:read'],['messages:send','contacts:read'],['events:write']]){
  const result=apiKeyCreationSchema.safeParse({label:'Unsafe',scopes,expires_in_days:null});
  assert.equal(result.success,false,JSON.stringify(scopes));
 }
});
test('invalid durations are rejected and ordinary URA token still expires',()=>{
 for(const days of [0,-1,366,'365','never']){
  assert.equal(apiKeyCreationSchema.safeParse({label:'URA',scopes:['messages:send'],expires_in_days:days}).success,false,String(days));
 }
 assert.equal(apiKeyCreationSchema.parse({label:'URA',scopes:['messages:send'],expires_in_days:90}).expires_in_days,90);
});
