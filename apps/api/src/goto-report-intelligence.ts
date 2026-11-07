import crypto from 'node:crypto';
import type {NormalizedGotoEvent} from './goto-event-normalizer.js';

type Obj=Record<string,unknown>;
const obj=(x:unknown):Obj|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:null;
const str=(x:unknown):string|null=>typeof x==='string'&&x.length>0&&x.length<150?x:null;
const list=(x:unknown):unknown[]=>Array.isArray(x)?x.slice(0,300):[];
const digest=(x:string)=>crypto.createHash('sha256').update(x).digest('hex');
export const GOTO_AI_SIGNAL_TYPES=[
 'AI_INSIGHT_PROFANITY_DETECTED',
 'AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED',
 'AI_INSIGHT_APPOINTMENT_SET_DETECTED',
 'AI_INSIGHT_APPOINTMENT_MISSED_DETECTED',
 'AI_INSIGHT_SALE_PITCH_DETECTED',
 'AI_INSIGHT_SALE_CLOSE_DETECTED',
 'AI_INSIGHT_SALE_PITCH_FAILED_DETECTED'
] as const;
export const AI_SIGNAL_LABELS:Record<string,string>={
 AI_INSIGHT_PROFANITY_DETECTED:'Linguagem inadequada identificada',
 AI_INSIGHT_APPOINTMENT_OPPORTUNITY_DETECTED:'Oportunidade de agendamento',
 AI_INSIGHT_APPOINTMENT_SET_DETECTED:'Agendamento identificado',
 AI_INSIGHT_APPOINTMENT_MISSED_DETECTED:'Oportunidade de agendamento não aproveitada',
 AI_INSIGHT_SALE_PITCH_DETECTED:'Apresentação comercial identificada',
 AI_INSIGHT_SALE_CLOSE_DETECTED:'Possível fechamento de venda',
 AI_INSIGHT_SALE_PITCH_FAILED_DETECTED:'Abordagem comercial sem fechamento'
};
const AI=new Set<string>(GOTO_AI_SIGNAL_TYPES);
const VOICEMAIL=new Set(['VOICEMAIL_NEW','VOICEMAIL_READ','VOICEMAIL_DELETED']);
const ISSUES=new Set(['AIR_SCHEDULING_INTERRUPTED','AIR_SCHEDULING_ERROR']);

export type CallSignal={event:NormalizedGotoEvent; label:string};

/**
 * Read only explicitly documented action codes. Reports may include AI
 * summaries and personally identifiable transcripts; never persist those.
 */
export function extractGotoReportSignals(report:unknown):CallSignal[]{
 const root=obj(report);
 if(!root)return [];
 const conversationId=str(root.conversationSpaceId),accountKey=str(root.accountKey);
 if(!conversationId||!accountKey)return [];
 const nested: Array<{data:unknown;scope:string;position:number}>=[];
 const add=(value:unknown,scope:string)=>{for(const [position,x] of list(value).entries())nested.push({data:x,scope,position})};
 add(root.actions,'report');
 for(const [i,person] of list(root.participants).entries()){
  const p=obj(person);if(!p)continue;
  const personId=str(p.participantId)||String(i);
  add(p.actions,'participant:'+personId);
  for(const [j,perspective] of list(p.callPerspectives||p.perspectives).entries()){
   const v=obj(perspective);if(v)add(v.actions,'perspective:'+personId+':'+j);
  }
 }
 // Some reports attach actions to a call state or AI/virtual participant.
 for(const [i,state] of list(root.callStates).entries()){
  const st=obj(state);if(st)add(st.actions,'state:'+i);
 }
 const result:CallSignal[]=[];
 const seen=new Set<string>();
 const happened=str(root.callEnded)||new Date().toISOString();
 for(const {data,scope,position} of nested.slice(0,300)){
  const action=obj(data);if(!action)continue;
  const typeField=obj(action.type);
  const type=str(action.type)||str(typeField?.value)||str(action.actionType);
  if(!type||!(AI.has(type)||VOICEMAIL.has(type)||ISSUES.has(type)))continue;
  const transcriptId=str(action.transcriptId);
  const voicemailId=str(action.voicemailId);
  const providerId=str(action.eventId)||str(action.id);
  const eventType=AI.has(type)?'call.ai.insight.detected':
   type==='VOICEMAIL_NEW'?'call.voicemail.new':
   type==='VOICEMAIL_READ'?'call.voicemail.read':
   type==='VOICEMAIL_DELETED'?'call.voicemail.deleted':'call.receptionist.scheduling_issue';
  // Prefer provider stable identifiers over payload ordering; no raw IDs in storage.
  const identifier=providerId||transcriptId||voicemailId;
  // Duplicate signal exposed in root and participant arrays must only be stored once.
  const key=identifier?type+':'+identifier:type+':'+scope+':'+position;
  if(seen.has(key))continue;
  seen.add(key);
  const stamp=str(action.timestamp)||str(action.createdTime)||happened;
  const date=Date.parse(stamp);
  const occurredAt=Number.isFinite(date)?new Date(date).toISOString():new Date().toISOString();
  const metadata:Record<string,unknown>={
   signal_code:type,
   signal_group:AI.has(type)?'ai':VOICEMAIL.has(type)?'voicemail':'receptionist',
   has_transcript_reference:!!transcriptId
  };
  if(VOICEMAIL.has(type)){
   const duration=action.durationMs;
   if(typeof duration==='number'&&Number.isSafeInteger(duration)&&duration>=0&&duration<=86400000)
    metadata.duration_ms=duration;
  }
  result.push({
   label:AI_SIGNAL_LABELS[type]||({
    VOICEMAIL_NEW:'Novo recado de voz',
    VOICEMAIL_READ:'Recado de voz ouvido',
    VOICEMAIL_DELETED:'Recado de voz excluído',
    AIR_SCHEDULING_INTERRUPTED:'Agendamento da recepcionista IA interrompido',
    AIR_SCHEDULING_ERROR:'Erro de agendamento da recepcionista IA'
   } as Record<string,string>)[type]||'Sinal GoTo',
   event:{
    source:'call-events-report',externalKey:'signal:'+digest(conversationId+':'+key),
    type:eventType,conversationId,occurredAt,direction:str(root.direction),
    stateType:null,sequence:null,accountKey,metadata
   }
  });
 }
 return result;
}

export type AttentionLevel='unclassified'|'review'|'evidence_of_answer';
/** Never equate a missing participant with proof of a missed call. */
export function assessCallAttention(report:unknown):AttentionLevel{
 const data=obj(report);
 if(!data||data.direction!=='INBOUND'||!str(data.callEnded))return 'unclassified';
 const states=list(data.callStates);
 if(states.length===0)return 'unclassified';
 for(const state of states){
  const s=obj(state);
  for(const participant of list(s?.participants)){
   const p=obj(participant),type=obj(p?.type),status=obj(p?.status);
   if(type?.value==='LINE'&&status?.value==='CONNECTED')return 'evidence_of_answer';
  }
 }
 // No evidence of an agent connection; this is a review hint, NOT a missed-call flag.
 return 'review';
}
