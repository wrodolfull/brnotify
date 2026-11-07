import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractGotoReportSignals,assessCallAttention} from './goto-report-intelligence.js';
import {flowSchema,matchesFlow} from './automation-model.js';

const base={
 accountKey:'123456789012',conversationSpaceId:'a4c4816d-cbd4-4b5a-a607-f01cd5a88201',
 callEnded:'2026-11-07T12:00:00Z',direction:'INBOUND'
};
test('extracts only documented AI actions, voicemail and receptionist problems',()=>{
 const report={...base,actions:[
  {type:'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED',transcriptId:'transcript-1',summary:'PRIVATE TRANSCRIPT'},
  {type:'VOICEMAIL_NEW',voicemailId:'voicemail-1',durationMs:11000,privateField:'PRIVATE VOICEMAIL DATA'},
  {type:'AIR_SCHEDULING_ERROR',eventId:'event-a1',errorText:'PRIVATE CALL NOTES'},
  {type:'OTHER',message:'PRIVATE UNKNOWN'},
  {type:'AI_INTERACTION_INSIGHT',transcript:'PRIVATE'}
 ]};
 const signals=extractGotoReportSignals(report);
 assert.deepEqual(signals.map(x=>x.event.type),[
  'call.ai.insight.detected','call.voicemail.new','call.receptionist.scheduling_issue'
 ]);
 assert.equal(signals[0].event.metadata.signal_code,'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED');
 assert.equal(signals[0].event.metadata.has_transcript_reference,true);
 assert.equal(signals[1].event.metadata.duration_ms,11000);
 assert.ok(!JSON.stringify(signals).includes('PRIVATE'));
 assert.ok(!JSON.stringify(signals).includes('transcript-1'));
 assert.ok(!JSON.stringify(signals).includes('voicemail-1'));
 assert.equal(extractGotoReportSignals(report)[0].event.externalKey,signals[0].event.externalKey);
});
test('deduplicates same provider signal included at report and participant level',()=>{
 const action={type:{value:'AI_INSIGHT_SALE_CLOSE_DETECTED'},transcriptId:'same-transcript'};
 const report={...base,actions:[action],participants:[{participantId:'participant-1',actions:[action]}]};
 assert.equal(extractGotoReportSignals(report).length,1);
});
test('includes supported voicemail lifecycle changes separately, never inferred',()=>{
 const report={...base,actions:[
  {type:'VOICEMAIL_NEW',voicemailId:'voice',createdTime:'2026-11-07T12:00:00Z'},
  {type:'VOICEMAIL_READ',voicemailId:'voice'},
  {type:'VOICEMAIL_DELETED',voicemailId:'voice'}
 ]};
 assert.deepEqual(extractGotoReportSignals(report).map(x=>x.event.type),[
  'call.voicemail.new','call.voicemail.read','call.voicemail.deleted'
 ]);
});
test('call attention is not a definitive missed-call classification',()=>{
 assert.equal(assessCallAttention({...base,callStates:[]}), 'unclassified');
 assert.equal(assessCallAttention({...base,callStates:[{participants:[]}]}),'review');
 assert.equal(assessCallAttention({...base,direction:'OUTBOUND',callStates:[{participants:[]}]}),'unclassified');
 assert.equal(assessCallAttention({...base,callStates:[{participants:[{
  status:{value:'CONNECTED'},type:{value:'LINE'}
 }]}]}),'evidence_of_answer');
});
test('AI workflows require allowlisted insight types and forbid automatic call-to-WhatsApp',()=>{
 const workflow={
  title:'Oportunidade de agendamento',trigger_type:'call.ai.insight.detected',
  match_mode:'equals',match_text:'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED',
  delay_minutes:0,check_no_new_message:false,action_type:'internal',action_label:'Avisar responsável',
  endpoint_id:null,template_id:null,template_variables:{}
 };
 assert.equal(flowSchema.safeParse(workflow).success,true);
 assert.equal(flowSchema.safeParse({...workflow,match_text:'DANGEROUS_UNKNOWN'}).success,false);
 assert.equal(flowSchema.safeParse({...workflow,action_type:'whatsapp'}).success,false);
 const event={id:'event',event_type:'call.ai.insight.detected',occurred_at:base.callEnded,
  conversation_space_id:base.conversationSpaceId,
  metadata:{signal_code:'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED'}};
 assert.equal(matchesFlow(flowSchema.parse(workflow),event),true);
 assert.equal(matchesFlow(flowSchema.parse(workflow),{
  ...event,metadata:{signal_code:'AI_INSIGHT_SALE_CLOSE_DETECTED'}
 }),false);
});
