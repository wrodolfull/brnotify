import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasBatchExamplePlaceholders,normalizeBatchHeader} from './import-template-help.js';

test('batch import accepts annotated required and optional headers without renaming variable keys',()=>{
 assert.equal(normalizeBatchHeader('whatsapp (obrigatório)'),'whatsapp');
 assert.equal(normalizeBatchHeader('data_envio (opcional)'),'data_envio');
 assert.equal(normalizeBatchHeader('hora_envio (opcional)'),'hora_envio');
 assert.equal(normalizeBatchHeader('body.1 (obrigatório)'),'body.1');
 assert.equal(normalizeBatchHeader('buttons.0.codigo (obrigatorio)'),'buttons.0.codigo');
 assert.equal(normalizeBatchHeader('header.media'),'header.media');
 assert.equal(normalizeBatchHeader('whatsapp'),'whatsapp');
});

test('untouched examples cannot be sent in real WhatsApp batches',()=>{
 assert.equal(hasBatchExamplePlaceholders('+5511999999999',{}),true);
 assert.equal(hasBatchExamplePlaceholders('+55 (11) 99999-9999',{a:'ok'}),true);
 assert.equal(hasBatchExamplePlaceholders('+5511987654321',{'body.1':'SUBSTITUIR_EXEMPLO'}),true);
 assert.equal(hasBatchExamplePlaceholders('+5511987654321',{'body.1':'João Silva'}),false);
 assert.equal(hasBatchExamplePlaceholders('+5511987654321',{}),false);
});
