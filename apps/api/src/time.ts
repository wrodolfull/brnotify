import {DateTime} from 'luxon';
import {query} from './db.js';

export function phoneE164(v:unknown){
 const digits=String(v??'').replace(/\D/g,'');
 const full=digits.length===10||digits.length===11?'55'+digits:digits;
 if(full.length<11||full.length>15)throw new Error('WhatsApp inválido; informe DDD e número');
 return '+'+full;
}
export function toUTC(value:string,timezone:string){
 // Aceita data local YYYY-MM-DD ou data/hora local YYYY-MM-DDTHH:mm.
 const dt=DateTime.fromISO(value,{zone:timezone});
 if(!dt.isValid)throw new Error('Data inválida');
 return dt.toUTC().toISO()!;
}
export function parseImportedDate(v:unknown){
 if(v instanceof Date)return DateTime.fromJSDate(v,{zone:'utc'}).toFormat('yyyy-MM-dd');
 const s=String(v??'').trim();
 const br=DateTime.fromFormat(s,'dd/MM/yyyy');
 if(br.isValid)return br.toISODate()!;
 const brTime=DateTime.fromFormat(s,'dd/MM/yyyy HH:mm');
 if(brTime.isValid)return brTime.toFormat("yyyy-MM-dd'T'HH:mm");
 if(DateTime.fromISO(s).isValid)return s;
 throw new Error('Data inválida: use DD/MM/AAAA ou AAAA-MM-DD');
}
export type Rule={slot:number;enabled:boolean;offset_value:number;offset_unit:'days'|'weeks'|'months';send_time:string;template_id:string|null};
export function calculateReminder(eventISO:string,zone:string,rule:Rule){
 const event=DateTime.fromISO(eventISO,{zone:'utc'}).setZone(zone);
 const local=event.minus({[rule.offset_unit]:rule.offset_value});
 const [hour,minute]=rule.send_time.split(':').map(Number);
 const at=local.set({hour,minute,second:0,millisecond:0});
 if(!at.isValid)throw new Error('Regra de lembrete inválida');
 return at.toUTC().toISO()!;
}
export async function rebuildEvent(tenantId:string,eventId:string){
 const loaded=await query(
  'select e.*,t.timezone,c.consent,c.opted_out_at,c.reminder_overrides as contact_overrides from events e join tenants t on t.id=e.tenant_id join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id where e.tenant_id=$1 and e.id=$2',
  [tenantId,eventId]
 );
 if(!loaded.rowCount)return;
 const ev=loaded.rows[0];
 const rules=await query('select * from reminder_rules where tenant_id=$1 order by slot',[tenantId]);
 const active=ev.status==='scheduled'&&ev.consent&&!ev.opted_out_at;
 const overrides=ev.reminder_overrides||ev.contact_overrides||{};
 const validSlots:number[]=[];
 for(const base of rules.rows as Rule[]){
  const custom=overrides[String(base.slot)]||{};
  const rule:Rule={...base,...custom,slot:base.slot};
  if(!active||!rule.enabled)continue;
  const due=calculateReminder(ev.starts_at.toISOString(),ev.timezone,rule);
  if(DateTime.fromISO(due).toMillis()<=Date.now())continue;
  if(DateTime.fromISO(due).toMillis()>=new Date(ev.starts_at).getTime())continue;
  validSlots.push(rule.slot);
  await query(
   "insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,template_id) values($1,$2,$3,$4,$5) on conflict(event_id,slot) do update set scheduled_at=excluded.scheduled_at,template_id=excluded.template_id,status='scheduled',error_code=null,error_description=null,updated_at=now() where scheduled_messages.status in ('scheduled','cancelled')",
   [tenantId,eventId,rule.slot,due,rule.template_id]
  );
 }
 await query("update scheduled_messages set status='cancelled',updated_at=now() where tenant_id=$1 and event_id=$2 and status='scheduled' and not(slot=any($3::int[]))",[tenantId,eventId,validSlots]);
}
