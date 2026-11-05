import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preserveAuthenticatedView,requireActiveSession} from './src/auth-session.ts';
const make=(id,token)=>({user:{id},access_token:token});

test('SIGNED_IN on tab focus preserves the mounted workspace',()=>{
 const initial=make('user-1','old-token');
 const focused=make('user-1','new-token');
 assert.strictEqual(preserveAuthenticatedView(initial,focused),initial);
});
test('TOKEN_REFRESHED uses current access token without reinitializing the page',()=>{
 const initial=make('user-1','old-token');
 const ref={current:initial};
 const fresh=make('user-1','new-token');
 ref.current=fresh; // onAuthStateChange updates the ref synchronously.
 assert.strictEqual(preserveAuthenticatedView(initial,fresh),initial);
 assert.equal(requireActiveSession(ref).access_token,'new-token');
});
test('switching accounts replaces the UI state and signed out clears it',()=>{
 const initial=make('user-1','old-token');
 const different=make('user-2','user-2-token');
 assert.strictEqual(preserveAuthenticatedView(initial,different),different);
 assert.equal(preserveAuthenticatedView(initial,null),null);
 assert.strictEqual(preserveAuthenticatedView(null,different),different);
});
test('requests never use a signed-out session',()=>{
 assert.throws(()=>requireActiveSession({current:null}),/Sessão encerrada/);
});
