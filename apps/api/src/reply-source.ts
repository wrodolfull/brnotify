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


/**
 * Workflow routing needs the identity of the template, not of a specific appointment.
 * Multiple sends of the same template have identical configured reply options; treat
 * them as one template candidate. DIFFERENT templates, including NULL, remain ambiguous.
 * Do not use this function to confirm individual appointments.
 */
type FlowTemplateCandidate={template_id:string|null;send_count:number;message_id:string|null};
async function flowTemplateCandidates(client:Pick<PoolClient,'query'>,tenantId:string,phone:string,at:Date):Promise<FlowTemplateCandidate[]>{
 const result=await client.query(`
  select template_id,count(*)::int as send_count,
   case when count(*)=1 then min(id::text) else null end as message_id
  from (
   select m.template_id,m.id,m.sent_at
    from on_demand_messages m where m.tenant_id=$1 and m.recipient_phone=$2
    and m.provider_message_id is not null and m.sent_at is not null
    and m.status in ('sent','delivered')
   union all
   select m.template_id,m.id,m.sent_at
    from scheduled_messages m join events e on e.id=m.event_id and e.tenant_id=m.tenant_id
    join contacts c on c.id=e.contact_id and c.tenant_id=e.tenant_id
    where m.tenant_id=$1 and c.phone=$2 and m.goto_message_id is not null
    and m.sent_at is not null and m.status in ('sent','delivered')
  ) outbound
  where sent_at<=$3::timestamptz
   and sent_at>$3::timestamptz-interval '7 days'
  group by template_id limit 2`,[tenantId,phone,at.toISOString()]);
 return result.rows as FlowTemplateCandidate[];
}
export type ReplyFlowTemplateSource={templateId:string;messageId:string|null;sendCount:number};
export async function resolveFlowTemplateSource(client:Pick<PoolClient,'query'>,tenantId:string,rawPhone:unknown,rawAt:unknown):Promise<ReplyFlowTemplateSource|null>{
 let phone:string;
 try{phone=phoneE164(rawPhone)}catch{return null}
 const at=new Date(String(rawAt||''));
 if(!Number.isFinite(at.getTime()))return null;
 const candidates=await flowTemplateCandidates(client,tenantId,phone,at);
 if(candidates.length!==1||!candidates[0].template_id)return null;
 return {templateId:candidates[0].template_id,messageId:candidates[0].message_id,
  sendCount:Number(candidates[0].send_count)};
}

/** Explain why an inbound reply was not associated, without revealing a contact phone number. */
export async function diagnoseUnmatchedReply(client:Pick<PoolClient,'query'>,tenantId:string,rawPhone:unknown,rawAt:unknown):Promise<string>{
 let phone:string;
 try{phone=phoneE164(rawPhone)}
 catch{return 'A GoTo informou um identificador de destinatário que não pode ser interpretado como telefone E.164. Confira o autor da mensagem recebida.'}
 const at=new Date(String(rawAt||''));
 if(!Number.isFinite(at.getTime()))return 'A GoTo enviou uma data de resposta inválida; não é seguro relacionar ao disparo.';
 const candidates=await flowTemplateCandidates(client,tenantId,phone,at);
 if(candidates.length>1)
  return 'Há disparos aceitos de dois ou mais templates diferentes para este número nos últimos 7 dias. A GoTo não indica qual template foi respondido; a automação não será executada.';
 if(candidates.length===1&&!candidates[0].template_id)
  return 'Foi encontrado um envio, mas seu template de origem não está mais disponível no histórico.';
 if(candidates.length===1)
  return 'O template encontrado nos envios anteriores é diferente do template selecionado nesta automação.';
 // Check the most recent IVR/panel sends even if they were not accepted or fell outside the time window.
 const history=await client.query(`
  select status,sent_at,provider_message_id,template_id
  from on_demand_messages where tenant_id=$1 and recipient_phone=$2
  order by created_at desc limit 15`,[tenantId,phone]);
 if(!history.rowCount)
  return 'Não foi encontrado disparo da URA ou do painel para o número recebido. Confira se o número de origem informado pela GoTo corresponde ao destinatário registrado no mesmo ambiente.';
 const rows=history.rows as Array<{status:string;sent_at:Date|string|null;provider_message_id:string|null;template_id:string|null}>;
 const accepted=rows.filter(r=>['sent','delivered'].includes(r.status)&&r.provider_message_id&&r.sent_at);
 if(accepted.length){
  const before=accepted.filter(r=>new Date(r.sent_at!).getTime()<=at.getTime());
  if(!before.length)return 'Foram encontrados disparos, mas o horário de envio é posterior ao horário informado na resposta pela GoTo. Confira datas e processamento.';
  if(before.every(r=>new Date(r.sent_at!).getTime()<=at.getTime()-7*86400000))
   return 'Os disparos aceitos encontrados para esse número são anteriores à janela de 7 dias da automação.';
  return 'Existem disparos registrados, mas nenhum atende simultaneamente aos critérios de data, status aceito e identificador GoTo.';
 }
 if(rows.some(r=>r.status==='queued'||r.status==='processing'))
  return 'Existe disparo para esse número, mas ele ainda está na fila ou em processamento, sem confirmação de envio pela GoTo.';
 if(rows.some(r=>r.status==='failed'||r.status==='cancelled'))
  return 'Existem disparos para esse número, mas estão com falha ou cancelados. Verifique o histórico de disparos da URA.';
 if(rows.some(r=>r.status==='unknown'))
  return 'O último envio desse número tem resultado indeterminado. É necessário conciliar o identificador da GoTo antes de automatizar a resposta.';
 return 'Há um registro de envio para esse número, porém falta status de envio aceito, horário ou identificador GoTo para associar a resposta.';
}
