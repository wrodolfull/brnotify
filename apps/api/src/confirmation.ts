import {query,pool} from './db.js';
import {phoneE164} from './time.js';

export type ConfirmationDecision='confirmed'|'reschedule_requested'|'declined';
export function classifyConfirmation(text:unknown):ConfirmationDecision|null{
 const normalized=String(text??'').trim().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[!?.]+$/g,'');
 if(['SIM','CONFIRMO','CONFIRMAR','CONFIRMADO','1'].includes(normalized))return 'confirmed';
 if(['REAGENDAR','REMARCAR','QUERO REAGENDAR','2'].includes(normalized))return 'reschedule_requested';
 if(['NAO VOU','NAO PODEREI','CANCELAR AGENDAMENTO','3'].includes(normalized))return 'declined';
 return null;
}
export async function registerIncomingDecision(tenantId:string,providerEventId:string,payload:any){
 if(payload?.channel!=='WHATSAPP'||payload?.direction!=='INBOUND')return false;
 const decision=classifyConfirmation(payload.body);
 if(!decision)return false;
 let phone:string;
 try{phone=phoneE164(payload.authorTouchpoint)}catch{return false}
 const client=await pool.connect();
 try{
  await client.query('begin');
  const contact=await client.query(
   'select id from contacts where tenant_id=$1 and phone=$2 and opted_out_at is null',
   [tenantId,phone]
  );
  if(!contact.rowCount){
   await client.query('insert into inbound_interactions(tenant_id,provider_event_id,decision,resolution) values($1,$2,$3,$4) on conflict(provider_event_id) do nothing',[tenantId,providerEventId,decision,'contact_not_found']);
   await client.query('commit');
   return true;
  }
  const contactId=contact.rows[0].id as string;
  // Nunca pressupor que uma resposta é do agendamento mais recente se há ambiguidade.
  // O envio anterior deve ser um lembrete real e recente, não somente um cadastro.
  const candidates=await client.query(
   `select distinct e.id
    from events e join scheduled_messages m
      on m.event_id=e.id and m.tenant_id=e.tenant_id
    where e.tenant_id=$1 and e.contact_id=$2
      and e.confirmation_enabled and e.confirmation_status='pending'
      and e.status='scheduled' and e.starts_at>now()
      and m.sent_at>=now()-interval '7 days'
      and m.goto_message_id is not null
    order by e.id limit 2`,
   [tenantId,contactId]
  );
  const resolution=candidates.rowCount===1?'matched':candidates.rowCount===0?'no_matching_event':'ambiguous';
  let eventId:string|null=null;
  if(resolution==='matched'){
   eventId=candidates.rows[0].id;
   const result=await client.query(
    "update events set confirmation_status=$3,confirmation_received_at=now(),status=case when $3='declined' then 'cancelled' else status end,updated_at=now() where tenant_id=$1 and id=$2 and confirmation_status='pending' and status='scheduled' returning id",
    [tenantId,eventId,decision]
   );
   if(!result.rowCount)eventId=null;
   else if(decision==='declined'||decision==='reschedule_requested'){
    await client.query("update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id=$2 and status='scheduled'",[tenantId,eventId]);
   }
  }
  await client.query(
   'insert into inbound_interactions(tenant_id,provider_event_id,contact_id,event_id,decision,resolution) values($1,$2,$3,$4,$5,$6) on conflict(provider_event_id) do nothing',
   [tenantId,providerEventId,contactId,eventId,decision,eventId?'matched':resolution]
  );
  await client.query('commit');
  return true;
 }catch(e){await client.query('rollback');throw e}
 finally{client.release()}
}
