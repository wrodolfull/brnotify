import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {normalizeOnDemandInput,onDemandFingerprint,prepareOnDemandTemplate,makeOnDemandPayload}=await import('./on-demand-model.js');
const uuid='5e5f8118-7fb8-4201-812f-043cb9973255';
const basic={to:'(19) 99999-9999',template:'continuar_whatsapp',consent:{confirmed:true,source:'ivr_option_whatsapp'}};
test('the IVR does not require a Call ID, date, calendar or contact name',()=>{
 const input=normalizeOnDemandInput(basic);
 assert.equal(input.to,'+5519999999999');
 assert.equal(input.template,'continuar_whatsapp');
 assert.deepEqual(input.variables,{});
 assert.equal(input.language,'pt_BR');
});
test('authorization and consent are mandatory; unknown extra fields rejected',()=>{
 assert.throws(()=>normalizeOnDemandInput({...basic,consent:undefined}));
 assert.throws(()=>normalizeOnDemandInput({...basic,consent:{confirmed:false,source:'ivr_option_whatsapp'}}));
 assert.throws(()=>normalizeOnDemandInput({...basic,callId:'something'}));
});
test('idempotency signature is stable for reordered variables and tenant-specific',()=>{
 const a=normalizeOnDemandInput({...basic,variables:{'body.nome':'Carlos','body.protocolo':'123'}});
 const b=normalizeOnDemandInput({...basic,variables:{'body.protocolo':'123','body.nome':'Carlos'}});
 const first=onDemandFingerprint(uuid,a,'50120411-a5a9-4856-9b63-420ca623c8a0');
 assert.equal(first,onDemandFingerprint(uuid,b,'50120411-a5a9-4856-9b63-420ca623c8a0'));
 assert.notEqual(first,onDemandFingerprint('1c2e6f7f-f894-4cae-8afc-651387adbc8a',b,'50120411-a5a9-4856-9b63-420ca623c8a0'));
 assert.notEqual(first,onDemandFingerprint(uuid,{...b,variables:{...b.variables,'body.nome':'Ana'}},'50120411-a5a9-4856-9b63-420ca623c8a0'));
});
test('render approved simple template and reject missing/unknown variables',()=>{
 const template={
  name:'continuar_whatsapp',language_code:'pt_BR',status:'APPROVED',
  definition:{components:[{type:'body',components:[{type:'text',parameters:[{name:'parameter_0'}]}]}]},
  variable_map:{}
 };
 const input=normalizeOnDemandInput({...basic,variables:{'body.parameter_0':'Olá do atendimento'}});
 const result=makeOnDemandPayload(template,input,'137169456416846');
 assert.equal(result.attributes.name,'continuar_whatsapp');
 assert.deepEqual(result.to,['+5519999999999']);
 assert.deepEqual(result.components,[{type:'body',parameters:[{name:'parameter_0',value:'Olá do atendimento'}]}]);
 assert.throws(()=>prepareOnDemandTemplate(template,normalizeOnDemandInput(basic)),/variável/);
 assert.throws(()=>prepareOnDemandTemplate(template,normalizeOnDemandInput({...basic,variables:{'body.unexpected':'x'}})),/Variável desconhecida/);
 assert.throws(()=>prepareOnDemandTemplate({...template,status:'PENDING'},input),/aprovado/);
});
