import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {
 randomTenantDelay,retryAfterMilliseconds,retryDelayMilliseconds,
 classifyProviderFailure,MIN_TENANT_DELAY_MS,MAX_TENANT_DELAY_MS
}=await import('./send-pacing.js');
test('per-tenant spacing stays within 1–5 seconds and has jitter',()=>{
 const delays=Array.from({length:200},randomTenantDelay);
 assert.ok(delays.every(ms=>ms>=MIN_TENANT_DELAY_MS&&ms<=MAX_TENANT_DELAY_MS));
 assert.ok(new Set(delays).size>1);
});
test('Retry-After accepts seconds and HTTP dates but clamps extreme values',()=>{
 const now=Date.UTC(2026,10,5,14,0,0);
 assert.equal(retryAfterMilliseconds('45',now),45_000);
 assert.equal(retryAfterMilliseconds('Thu, 05 Nov 2026 14:01:00 GMT',now),60_000);
 assert.equal(retryAfterMilliseconds('99999999',now),3600_000);
 assert.equal(retryAfterMilliseconds('-4',now),null);
 assert.equal(retryAfterMilliseconds('invalid',now),null);
 assert.equal(retryAfterMilliseconds('0',now),1000);
});
test('429 retries are bounded, but ambiguous 5xx/timeout are never auto-resent',()=>{
 assert.equal(classifyProviderFailure(429,1),'retry');
 assert.equal(classifyProviderFailure(429,4),'retry');
 assert.equal(classifyProviderFailure(429,5),'failed');
 for(const status of [0,500,502,503,504])
  assert.equal(classifyProviderFailure(status,1),'unknown');
 assert.equal(classifyProviderFailure(400,1),'failed');
 assert.equal(classifyProviderFailure(401,1),'failed');
 assert.equal(classifyProviderFailure(403,1),'failed');
 assert.equal(classifyProviderFailure(null,1),'failed');
});
test('retry backoff respects provider cooldown and avoids immediate retries',()=>{
 const normal=retryDelayMilliseconds(1,null);
 assert.ok(normal>=31_000&&normal<=35_001);
 assert.ok(retryDelayMilliseconds(1,90_000)>=90_000);
 assert.ok(retryDelayMilliseconds(4,1000)>=240_000);
});

test('stale reminders older than 24 hours must not be dispatched automatically',async()=>{
 const {isStaleReminder,MAX_REMINDER_LATENESS_MS}=await import('./send-pacing.js');
 const now=Date.UTC(2026,10,5,10,0,0);
 assert.equal(isStaleReminder(new Date(now-MAX_REMINDER_LATENESS_MS-1),now),true);
 assert.equal(isStaleReminder(new Date(now-MAX_REMINDER_LATENESS_MS),now),false);
 assert.equal(isStaleReminder(new Date(now-60_000),now),false);
});
