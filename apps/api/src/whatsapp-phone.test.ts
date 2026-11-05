import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWhatsAppPhone} from './whatsapp-phone.js';

test('Brazilian DDD numbers receive +55 exactly once',()=>{
 assert.equal(normalizeWhatsAppPhone('(19) 99999-9999'),'+5519999999999');
 assert.equal(normalizeWhatsAppPhone('19999999999'),'+5519999999999');
 assert.equal(normalizeWhatsAppPhone('5519999999999'),'+5519999999999');
 assert.equal(normalizeWhatsAppPhone('+55 (19) 99999-9999'),'+5519999999999');
 assert.equal(normalizeWhatsAppPhone('1199999999'),'+551199999999');
});
test('International numbers retain their explicit country code',()=>{
 assert.equal(normalizeWhatsAppPhone('+1 514 555 2222'),'+15145552222');
 assert.equal(normalizeWhatsAppPhone('+351 912 345 678'),'+351912345678');
});
test('Reject ambiguous, invalid or double-prefixed destination numbers before send',()=>{
 for(const phone of ['','1234','0019999999999','+005519999999999','55+19999999999','+55 0 999999999','+55 19 9999999','+55 19 999999999999','123456789012','(19) 99999-9999 ramal 2']){
  assert.throws(()=>normalizeWhatsAppPhone(phone),/WhatsApp/,phone);
 }
});
