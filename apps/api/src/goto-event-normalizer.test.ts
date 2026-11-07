import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGotoEvent} from './goto-event-normalizer.js';

const metadata={accountKey:'123456789012',conversationSpaceId:'91be7aab-5856-485c-8823-60dd9924143f',
 direction:'INBOUND',callCreated:'2026-11-07T10:00:00Z'};
const state=(seq:number,type:string)=>({source:'call-events',type:'call-state',
 timestamp:'2026-11-07T10:00:00Z',
 content:JSON.stringify({metadata,state:{id:'state-'+seq,sequenceNumber:seq,type,
 timestamp:'2026-11-07T10:00:00Z',participants:[]}})});
test('normalizes documented GoTo call states with stable idempotency key',()=>{
 const one=normalizeGotoEvent(state(1,'STARTING'));
 const two=normalizeGotoEvent(state(2,'ACTIVE'));
 const three=normalizeGotoEvent(state(3,'ENDING'));
 assert.equal(one?.type,'call.started');
 assert.equal(two?.type,'call.updated');
 assert.equal(three?.type,'call.ended');
 assert.equal(three?.conversationId,metadata.conversationSpaceId);
 assert.equal(three?.sequence,3);
 assert.equal(three?.accountKey,metadata.accountKey);
 assert.equal(three?.externalKey,metadata.conversationSpaceId+':state-3');
});
test('report summary in documented data envelope is a pending report, not a missed call',()=>{
 const event=normalizeGotoEvent({data:{source:'call-events-report',type:'REPORT_SUMMARY',
  timestamp:'2026-11-07T10:01:00Z',content:{conversationSpaceId:metadata.conversationSpaceId}}});
 assert.equal(event?.type,'call.report.available');
 assert.equal(event?.accountKey,null);
 assert.equal(event?.conversationId,metadata.conversationSpaceId);
});
test('unsupported and malformed events are ignored',()=>{
 assert.equal(normalizeGotoEvent({source:'call-events',content:'{}'}),null);
 assert.equal(normalizeGotoEvent({source:'call-events',content:'not-json'}),null);
 assert.equal(normalizeGotoEvent(state(0,'ENDING')),null);
 assert.equal(normalizeGotoEvent(state(3,'OTHER')),null);
 assert.equal(normalizeGotoEvent({data:{source:'other',type:'REPORT_SUMMARY'}}),null);
});
test('normalizes received WhatsApp without storing raw provider envelopes',()=>{
 const event=normalizeGotoEvent({id:'in-123',source:'inbox-notification',type:'INBOUND_MESSAGE',
  content:{accountKey:'123456789012',payload:{channel:'WHATSAPP',authorTouchpoint:'+5511999999999',body:'Confirmo'}}});
 assert.equal(event?.type,'message.received');
 assert.equal(event?.metadata.text,'Confirmo');
 assert.equal(event?.metadata.phone,'+5511999999999');
});
