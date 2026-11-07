import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flowSchema,matchesFlow,interpolateVariables} from './automation-model.js';

const input={title:'Responder ao reagendamento',trigger_type:'message.received',
 match_mode:'equals',match_text:'2',delay_minutes:5,check_no_new_message:true,
 action_type:'internal',action_label:'Recepção deve retornar',endpoint_id:null,
 template_id:null,template_variables:{}};
test('accepts simple replies but rejects WhatsApp sends from unverified call events',()=>{
 assert.equal(flowSchema.safeParse(input).success,true);
 assert.equal(flowSchema.safeParse({...input,trigger_type:'call.ended',action_type:'whatsapp'}).success,false);
 assert.equal(flowSchema.safeParse({...input,delay_minutes:0,check_no_new_message:true}).success,false);
 assert.equal(flowSchema.safeParse({...input,trigger_type:'call.report.ready',match_mode:'contains'}).success,false);
 assert.equal(flowSchema.safeParse({...input,endpoint_id:'invalid-url'}).success,false);
});
test('matches WhatsApp text case-insensitively and filters other channels',()=>{
 const flow=flowSchema.parse(input);
 const event={id:'id',event_type:'message.received',occurred_at:'2026-11-07T00:00:00.000Z',
  conversation_space_id:null,metadata:{channel:'WHATSAPP',text:'  2 '}} as const;
 assert.equal(matchesFlow(flow,event),true);
 assert.equal(matchesFlow(flow,{...event,metadata:{...event.metadata,channel:'SMS'}}),false);
 assert.equal(matchesFlow(flow,{...event,metadata:{...event.metadata,text:'3'}}),false);
 assert.equal(matchesFlow({...flow,match_mode:'contains',match_text:'reagendar'},{
  ...event,metadata:{...event.metadata,text:'Quero REAGENDAR o serviço'}
 }),true);
});
test('supports approved, explicit template variables without arbitrary expressions',()=>{
 const values=interpolateVariables({
  'body.nome':'{{contact.name}}','body.telefone':'{{contact.phone}}','body.resposta':'{{message.text}}','body.tipo':'Lembrete'
 },{name:'Alice',phone:'+5519999999999'},'Confirmo');
 assert.deepEqual(values,{'body.nome':'Alice','body.telefone':'+5519999999999',
  'body.resposta':'Confirmo','body.tipo':'Lembrete'});
 assert.throws(()=>interpolateVariables({'body.a':''},{name:'Alice',phone:'123'},'Sim'),/inválida/);
});
