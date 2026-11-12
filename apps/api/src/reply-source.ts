import type {PoolClient} from 'pg';
import {phoneE164} from './time.js';

export type ReplySource={kind:'panel'|'reminder';templateId:string;messageId:string};
/**
 * GoTo inbound notifications do not guarantee a replied-to outbound message ID.
 * Only attribute the reply when a SINGLE accepted BR Notify send to that number
 * exists in the previous seven days. Never choose the latest from ambiguous sends.
 */
export async function resolveRecentReplySource(client:Pick<PoolClient,'query'>,tenantId:string,rawPhone:unknown,rawAt:unknown):Promise<ReplySource|null>{
 let phone:string;
 try{phone=phoneE164(rawPhone)}catch{return null}
 const at=new Date(String(rawAt||''));
 if(!Number.isFinite(at.getTime()))return null;
 const result=await client.query(`
  select kind,template_id,id from (
   select 'panel' as kind,m.template_id,m.id,m.sent_at
    from on_demand_messages m where m.tenant_id=$1 and m.recipient_phone=$2
    and m.provider_message_id is not null and m.sent_at is not null
    and m.status in ('sent','delivered')
   union all
   select 'reminder' as kind,m.template_id,m.id,m.sent_at
    from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id
    join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id
    where m.tenant_id=$1 and c.phone=$2 and m.goto_message_id is not null
    and m.sent_at is not null and m.status in ('sent','delivered')
  ) candidates where sent_at<=$3::timestamptz
   and sent_at>$3::timestamptz-interval '7 days'
  order by sent_at desc,id desc limit 2`,[tenantId,phone,at.toISOString()]);
 if(result.rows.length!==1||!result.rows[0].template_id)return null;
 const candidate=result.rows[0];
 return {kind:candidate.kind,templateId:candidate.template_id,messageId:candidate.id};
}
