import {z} from 'zod';

export const TRIGGER_TYPES=['message.received','message.delivery.updated','call.ended','call.report.ready'] as const;
export const ACTION_TYPES=['internal','webhook','whatsapp'] as const;
const uuid=z.string().uuid();
export const flowSchema=z.object({
 title:z.string().trim().min(3).max(120),
 trigger_type:z.enum(TRIGGER_TYPES),
 match_mode:z.enum(['any','equals','contains']).default('any'),
 match_text:z.string().trim().max(200).nullable().optional(),
 delay_minutes:z.number().int().min(0).max(10080).default(0),
 check_no_new_message:z.boolean().default(false),
 action_type:z.enum(ACTION_TYPES),
 action_label:z.string().trim().min(3).max(180).default('Ação automática'),
 endpoint_id:uuid.nullable().optional(),
 template_id:uuid.nullable().optional(),
 template_variables:z.record(z.string().min(1).max(200),z.string().trim().min(1).max(1024)).default({})
}).strict().superRefine((v,ctx)=>{
 const add=(message:string,path:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message,path:[path]});
 const inbound=v.trigger_type==='message.received';
 const delivery=v.trigger_type==='message.delivery.updated';
 if(!inbound&&!delivery&&v.match_mode!=='any')add('Este evento não oferece filtros adicionais.','match_mode');
 if(delivery&&v.match_mode==='contains')add('Para status de entrega, use comparação exata.','match_mode');
 if((inbound||delivery)&&v.match_mode!=='any'&&!v.match_text)add('Informe o texto ou status esperado.','match_text');
 if(v.check_no_new_message&&(!inbound||v.delay_minutes<1))add('A verificação de novas respostas exige um gatilho de WhatsApp e uma espera.','check_no_new_message');
 if(v.action_type==='whatsapp'){
  if(!inbound)add('Envio automático pelo WhatsApp nesta etapa exige uma mensagem recebida como gatilho.','action_type');
  if(!v.template_id)add('Escolha um template aprovado da GoTo.','template_id');
 }else if(v.template_id||Object.keys(v.template_variables).length)
  add('Template só é usado no envio por WhatsApp.','template_id');
 if(v.action_type==='webhook'&&!v.endpoint_id)add('Selecione um webhook já cadastrado.','endpoint_id');
 if(v.action_type!=='webhook'&&v.endpoint_id)add('Webhook só é utilizado na ação de integração.','endpoint_id');
});

export type FlowInput=z.infer<typeof flowSchema>;
export type EventForFlow={id:string;event_type:string;occurred_at:string;metadata:Record<string,any>;conversation_space_id:string|null};
export function matchesFlow(flow:Pick<FlowInput,'trigger_type'|'match_mode'|'match_text'>,event:EventForFlow){
 if(event.event_type!==flow.trigger_type)return false;
 const metadata=event.metadata||{};
 if(flow.trigger_type==='message.received'&&metadata.channel!=='WHATSAPP')return false;
 if(flow.trigger_type==='message.delivery.updated'&&metadata.channel&&metadata.channel!=='WHATSAPP')return false;
 if(flow.match_mode==='any')return true;
 const actual=String(flow.trigger_type==='message.delivery.updated'?metadata.delivery||'':metadata.text||'').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
 const expected=String(flow.match_text||'').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
 if(!expected)return false;
 return flow.match_mode==='equals'?actual===expected:actual.includes(expected);
}
export const dynamicTokens=['{{contact.name}}','{{contact.phone}}','{{message.text}}'] as const;
export function interpolateVariables(variables:Record<string,string>,contact:{name:string;phone:string},message:string){
 const values:Record<string,string>={};
 for(const [key,value] of Object.entries(variables)){
  if(value==='{{contact.name}}')values[key]=contact.name;
  else if(value==='{{contact.phone}}')values[key]=contact.phone;
  else if(value==='{{message.text}}')values[key]=message;
  else values[key]=value;
  if(!values[key]?.trim()||values[key].length>1024)throw new Error('Variável inválida: '+key);
 }
 return values;
}
