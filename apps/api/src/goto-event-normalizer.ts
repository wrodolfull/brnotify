import crypto from 'node:crypto';

export type NormalizedGotoEvent={
 source:'call-events'|'call-events-report'|'inbox-notification';
 externalKey:string;
 type:string;
 conversationId:string|null;
 occurredAt:string;
 direction:string|null;
 stateType:string|null;
 sequence:number|null;
 accountKey:string|null;
 metadata:Record<string,unknown>;
};

const object=(v:unknown):Record<string,any>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:null;
const contentOf=(raw:unknown):Record<string,any>|null=>{
 if(typeof raw==='string'){
  try{return object(JSON.parse(raw))}catch{return null}
 }
 return object(raw);
};
const limited=(value:unknown,max=180):string|null=>typeof value==='string'&&value.length>0&&value.length<=max?value:null;
const iso=(value:unknown):string=>{
 if(typeof value!=='string')return new Date().toISOString();
 // GoTo webhooks may contain RFC3339 timestamps with nanosecond precision.
 // Normalize to JS milliseconds so replayed REPORT_SUMMARY_REVISION is deduplicated.
 const normalized=value.replace(/(\\.\\d{3})\\d+(?=Z$)/i,'$1');
 const time=new Date(normalized);
 return Number.isFinite(time.getTime())?time.toISOString():new Date().toISOString();
};
const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');

export function normalizeGotoEvent(input:unknown):NormalizedGotoEvent|null{
 const original=object(input);
 if(!original)return null;
 const envelope=object(original.data)||original;
 const source=envelope.source;
 const content=contentOf(envelope.content);
 if(source==='call-events'){
  const metadata=object(content?.metadata);
  const state=object(content?.state);
  if(!metadata||!state)return null;
  const conversationId=limited(metadata?.conversationSpaceId,150);
  const stateId=limited(state?.id,150);
  const stateType=limited(state?.type,40);
  const accountKey=limited(metadata?.accountKey,100);
  if(!conversationId||!stateId||!stateType||!accountKey||!['STARTING','ACTIVE','ENDING'].includes(stateType))return null;
  const seq=state?.sequenceNumber;
  if(!Number.isSafeInteger(seq)||seq<1)return null;
  return {
   source,externalKey:conversationId+':'+stateId,type:stateType==='STARTING'?'call.started':stateType==='ENDING'?'call.ended':'call.updated',
   conversationId,occurredAt:iso(state.timestamp||envelope.timestamp),
   direction:limited(metadata?.direction,30),stateType,sequence:seq,accountKey,
   metadata:{direction:limited(metadata?.direction,30),state:stateType,sequence:seq,
    participants:Array.isArray(state.participants)?Math.min(state.participants.length,500):0}
  };
 }
 if(source==='call-events-report'&&(envelope.type==='REPORT_SUMMARY'||envelope.type==='REPORT_SUMMARY_REVISION')){
  const conversationId=limited(content?.conversationSpaceId,150);
  if(!conversationId)return null;
  const accountKey=limited(content?.accountKey,100);
  return {
   source,externalKey:conversationId+':'+envelope.type+':'+(envelope.type==='REPORT_SUMMARY_REVISION'?iso(envelope.timestamp):'initial'),
   type:'call.report.available',conversationId,occurredAt:iso(envelope.timestamp),direction:null,
   stateType:null,sequence:null,accountKey,metadata:{report_type:envelope.type}
  };
 }
 if(source==='inbox-notification'&&typeof original.id==='string'&&typeof original.type==='string'&&
  ['INBOUND_MESSAGE','DELIVERY_STATUS'].includes(original.type)){
  const payload=object(content?.payload);
  const key=limited(content?.accountKey,100);
  if(!key)return null;
  return {
   source,externalKey:original.id,type:original.type==='INBOUND_MESSAGE'?'message.received':'message.delivery.updated',
   conversationId:null,occurredAt:iso(envelope.timestamp||original.timestamp),direction:null,stateType:null,sequence:null,
   accountKey:key,metadata:original.type==='INBOUND_MESSAGE'
    ?{channel:limited(payload?.channel,30),phone:limited(payload?.authorTouchpoint,50),text:limited(payload?.body,500)}
    :{messageId:limited(payload?.messageId,180),delivery:limited(payload?.deliveryStatus?.description,80),channel:limited(payload?.channel,30)}
  };
 }
 return null;
}
