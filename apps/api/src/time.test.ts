import {test} from 'node:test';
import assert from 'node:assert/strict';
// Os testes de cálculo não fazem consultas ao banco.
process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY ||= '0'.repeat(64);
const {calculateReminder,phoneE164,parseImportedDate,toUTC}=await import('./time.js');

test('normaliza WhatsApp brasileiro com DDD',()=>{
 assert.equal(phoneE164('(19) 99999-9999'),'+5519999999999');
 assert.equal(phoneE164('+55 19 99999 9999'),'+5519999999999');
 assert.throws(()=>phoneE164('1234'),/WhatsApp inválido/);
});
test('subtrai mês de calendário e preserva horário local',()=>{
 const event=toUTC('2027-01-15T09:00','America/Sao_Paulo');
 const scheduled=calculateReminder(event,'America/Sao_Paulo',{slot:1,enabled:true,offset_value:1,offset_unit:'months',send_time:'09:00',template_id:null});
 assert.equal(scheduled,'2026-12-15T12:00:00.000Z');
});
test('calcula os lembretes de três e um dia antes',()=>{
 const event=toUTC('2026-12-15T09:00','America/Sao_Paulo');
 const base={slot:1,enabled:true,offset_unit:'days' as const,send_time:'09:00',template_id:null};
 assert.equal(calculateReminder(event,'America/Sao_Paulo',{...base,offset_value:3}),'2026-12-12T12:00:00.000Z');
 assert.equal(calculateReminder(event,'America/Sao_Paulo',{...base,offset_value:1}),'2026-12-14T12:00:00.000Z');
});
test('interpreta data brasileira de planilha',()=>{
 assert.equal(parseImportedDate('15/12/2026'),'2026-12-15');
 assert.throws(()=>parseImportedDate('31/02/2026'));
});

test('o cadastro rejeita DDI 00 e formato +55 com DDD incompleto',()=>{
 assert.throws(()=>phoneE164('005519999999999'),/WhatsApp/);
 assert.throws(()=>phoneE164('+5509999999999'),/WhatsApp/);
 assert.equal(phoneE164('5519999999999'),'+5519999999999');
});
