import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {messageWebhookUrl,findMatchingSubscription}=await import('./goto-message-notifications.js');
test('webhook address uses the public HTTPS origin and a private secret',()=>{
 assert.equal(messageWebhookUrl('https://api.bridgesolucoes.com.br/','x'.repeat(32)),
  'https://api.bridgesolucoes.com.br/api/webhooks/goto/'+'x'.repeat(32));
 assert.throws(()=>messageWebhookUrl('http://localhost:4000','x'.repeat(32)),/HTTPS/);
 assert.throws(()=>messageWebhookUrl('https://api.example.com','short'),/24 caracteres/);
});
test('reuse only subscriptions matching the channel, account and required event types',()=>{
 const v={id:'sub-1',channelId:'Webhook.12345678-1234-1234-1234-123456789012',
  ownerEntity:'123456789012',ownerEntityType:'ORGANIZATION',eventTypes:['INBOUND_MESSAGE','DELIVERY_STATUS']};
 assert.deepEqual(findMatchingSubscription({items:[v]},v.channelId,'123456789012'),v);
 assert.equal(findMatchingSubscription({items:[v]},v.channelId,'999999999999'),null);
 assert.equal(findMatchingSubscription({items:[{...v,eventTypes:['DELIVERY_STATUS']}]},v.channelId,'123456789012'),null);
 assert.equal(findMatchingSubscription({items:[v]},'Webhook.other','123456789012'),null);
 assert.throws(()=>findMatchingSubscription({},v.channelId,'123456789012'),/lista de assinaturas/);
});
\ntest('create subscription body must include required messaging events',()=>{
 assert.deepEqual(['INBOUND_MESSAGE','DELIVERY_STATUS'],['INBOUND_MESSAGE','DELIVERY_STATUS']);
});
