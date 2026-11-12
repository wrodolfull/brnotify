import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 clearQueryCache,invalidateQueryScope,loadQuery,peekQuery,queryKey,queryScope
} from './src/query-cache.ts';

test('cache reuses a tenant-scoped read without a second request',async()=>{
 clearQueryCache();
 const key=queryKey('user-a','tenant-a','/api/contacts?page=1');
 let requests=0;
 const fetcher=async()=>({items:[{id:'a'}],requests:++requests});
 const first=await loadQuery(key,fetcher);
 const second=await loadQuery(key,fetcher);
 assert.strictEqual(first,second);
 assert.equal(requests,1);
});

test('simultaneous reads share one in-flight fetch',async()=>{
 clearQueryCache();
 const key=queryKey('user-a','tenant-a','/api/dashboard');
 let requests=0;
 const fetcher=async()=>{
  requests++;
  await new Promise(r=>setTimeout(r,5));
  return {contacts:3};
 };
 const [a,b]=await Promise.all([loadQuery(key,fetcher),loadQuery(key,fetcher)]);
 assert.deepEqual(a,b);
 assert.equal(requests,1);
});

test('cache keeps different accounts, tenants, and filters isolated',async()=>{
 clearQueryCache();
 const a=queryKey('user-a','tenant-a','/api/contacts?page=1');
 const b=queryKey('user-a','tenant-b','/api/contacts?page=1');
 const c=queryKey('user-b','tenant-a','/api/contacts?page=1');
 const d=queryKey('user-a','tenant-a','/api/contacts?page=2');
 await Promise.all([
  loadQuery(a,async()=>({tenant:'A'})),
  loadQuery(b,async()=>({tenant:'B'})),
  loadQuery(c,async()=>({user:'B'})),
  loadQuery(d,async()=>({page:2}))
 ]);
 invalidateQueryScope(queryScope('user-a','tenant-a'));
 assert.equal(peekQuery(a),undefined);
 assert.equal(peekQuery(d),undefined);
 assert.deepEqual(peekQuery(b),{tenant:'B'});
 assert.deepEqual(peekQuery(c),{user:'B'});
});

test('invalidated pending reads cannot overwrite newer results',async()=>{
 clearQueryCache();
 const key=queryKey('u','t','/api/dashboard');
 let release;
 const older=loadQuery(key,()=>new Promise(resolve=>{release=resolve}));
 invalidateQueryScope(queryScope('u','t'));
 const newer=await loadQuery(key,async()=>({contacts:42}));
 release({contacts:1});
 await older;
 assert.deepEqual(peekQuery(key),newer);
});

test('a failed fetch is not cached and may be retried',async()=>{
 clearQueryCache();
 const key=queryKey('u','t','/api/contacts');
 await assert.rejects(loadQuery(key,async()=>{throw Error('network')}));
 assert.equal(peekQuery(key),undefined);
 assert.deepEqual(await loadQuery(key,async()=>({items:[]})),{items:[]});
 clearQueryCache();
 assert.equal(peekQuery(key),undefined);
});
