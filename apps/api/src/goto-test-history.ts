import {query} from './db.js';

/** Show GoTo template test delivery reports only when a matching webhook exists.
 * The same HMAC fingerprint identifies equivalent input formats, without revealing
 * the phone number.
 */
export async function listTemplateTestHistory(tenantId:string,run:typeof query=query){
 const response=await run(`
  select ts.id,ts.created_at,ts.provider_message_id,
         left(ts.recipient_hash,12) as recipient_fingerprint,
         case when ev.delivery_status is not null then ev.delivery_status
              when ts.provider_message_id is null then 'NO_PROVIDER_CONFIRMATION'
              else 'AWAITING_DELIVERY_STATUS' end as delivery_status,
         ev.delivery_code
  from goto_test_sends ts
  left join lateral(
   select wh.payload #>> '{content,payload,deliveryStatus,description}' as delivery_status,
          wh.payload #>> '{content,payload,deliveryStatus,code}' as delivery_code
   from webhook_events wh
   where wh.tenant_id=ts.tenant_id
     and wh.payload->>'type'='DELIVERY_STATUS'
     and wh.payload #>> '{content,payload,messageId}'=ts.provider_message_id
   order by wh.received_at desc limit 1
  ) ev on true
  where ts.tenant_id=$1
  order by ts.created_at desc limit 10
 `,[tenantId]);
 return response.rows;
}
