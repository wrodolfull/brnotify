/** Validate WhatsApp phone numbers without guessing national digits. */
export function normalizeWhatsAppPhone(value:unknown):string{
 const raw=String(value??'').trim();
 if(!raw||!/^\+?[\d\s().-]+$/.test(raw))
  throw new Error('WhatsApp inválido: use +55, DDD e número');
 const digits=raw.replace(/\D/g,'');
 if(digits.startsWith('00'))throw new Error('WhatsApp inválido: use + e DDI em vez de 00');
 let full:string;
 if(raw.startsWith('+'))full='+'+digits;
 else if([10,11].includes(digits.length))full='+55'+digits;
 else if([12,13].includes(digits.length)&&digits.startsWith('55'))full='+'+digits;
 else throw new Error('WhatsApp inválido: informe +DDI e número (Brasil: +55 + DDD + número)');
 if(!/^\+[1-9][0-9]{7,14}$/.test(full))
  throw new Error('WhatsApp inválido: formato E.164 necessário');
 if(full.startsWith('+55')&&!/^\+55[1-9][0-9][0-9]{8,9}$/.test(full))
  throw new Error('WhatsApp brasileiro inválido: verifique DDD e os 8/9 dígitos do telefone');
 return full;
}
