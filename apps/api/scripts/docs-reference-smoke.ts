import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openApiDefinition} from '../src/openapi.js';
import {collectOperations,endpointDocs,examplePath,generatedRequest} from '../../web/src/api-docs-data.js';

const snapshot=JSON.parse(readFileSync('apps/web/src/api-docs-openapi.json','utf8'));
assert.deepEqual(snapshot,openApiDefinition,
 'O snapshot do portal precisa acompanhar apps/api/src/openapi.ts');
const ops=collectOperations(snapshot);
assert.ok(ops.length>=15,'Endpoints da API pública incompletos');
const ids=new Set(ops.map(o=>o.id));
assert.equal(ids.size,ops.length,'Operações duplicadas');
assert.deepEqual(new Set(Object.keys(endpointDocs)),ids,
 'Documentação humana e OpenAPI divergem: adicione, remova ou altere operações');
assert.equal(ops.find(o=>o.id==='POST /messages/send')?.group,'Disparos');
assert.equal(ops.find(o=>o.id==='GET /messages/send/{id}')?.scopes[0],'messages:send');
assert.equal(ops.find(o=>o.id==='GET /messages')?.scopes[0],'messages:read');

for(const op of ops){
 assert.ok(op.description.length>20,op.id+' sem explicação adequada');
 assert.ok(op.scopes.length,op.id+' sem scopes');
 assert.ok(op.variants.length,op.id+' sem exemplos');
 assert.ok(op.response,op.id+' sem resposta de exemplo');
 for(const example of op.variants){
  const expected='/v1'+examplePath(op.path,example.pathParams||{});
  for(const language of ['curl','python','node'] as const){
   const result=generatedRequest({
    base:'https://api.example.com/',token:'brn_live_SEU_TOKEN_AQUI',
    method:op.method,path:op.path,variant:example,language
   });
   assert.ok(result.includes(expected),op.id+' '+example.id+' '+language+' usa rota incorreta');
   assert.ok(result.includes('brn_live_SEU_TOKEN_AQUI'),op.id+' '+language+' sem autenticação');
   assert.ok(result.includes(op.method),op.id+' '+language+' sem método HTTP');
   if(example.body){
    assert.ok(result.includes('Content-Type')||result.includes('json=payload'),op.id+' sem JSON');
   }
  }
  if(example.body){
   const schema= (snapshot.paths[op.path] as any)[op.method.toLowerCase()]
    ?.requestBody?.content?.['application/json']?.schema;
   if(schema?.additionalProperties===false){
    const allowed=new Set(Object.keys(schema.properties||{}));
    assert.ok(Object.keys(example.body).every(key=>allowed.has(key)),
     op.id+' possui campo não permitido no exemplo '+example.id);
   }
  }
 }
}
// Generates a value-safe Python example even when a JSON string contains "false".
const dynamic=generatedRequest({
 base:'https://api.example.com',token:'brn_live_SEU_TOKEN_AQUI',method:'POST',path:'/messages/send',
 variant:{id:'check',label:'Teste',body:{variables:{'body.parameter_0':'true false null'}}},language:'python'
});
assert.ok(dynamic.includes('import json'));
assert.ok(dynamic.includes('json.loads'));
assert.ok(dynamic.includes('true false null'),'Trechos literais não podem ser alterados');
assert.equal(examplePath('/events/{externalId}',{externalId:'CLIENTE/2026'}),'/events/CLIENTE%2F2026');
console.log('Documentação: snapshot sincronizado, '+ops.length+' operações e exemplos cURL/Python/Node verificados');
