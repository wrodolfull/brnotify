import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEMPLATE_LIBRARY,findPreset,suggestMapping,mergePresetMapping,type CatalogPreset} from './template-library.js';

function mockGoto(p:CatalogPreset){
 const components:any[]=[];
 if(p.header){
  components.push({type:'header',components:[
   p.header.type==='TEXT'
    ?{type:'text',attributes:{text:p.header.text},parameters:p.variables.filter(v=>v.part==='header').map((v,i)=>({name:'parameter_'+i}))}
    :{type:p.header.type.toLowerCase(),attributes:{attachmentName:null}}
  ]});
 }
 components.push({
  type:'body',components:[{
   type:'text',attributes:{text:p.body},parameters:p.variables.filter(v=>v.part==='body').map((v,i)=>({name:'parameter_'+i}))
  }]
 });
 if(p.footer)components.push({type:'footer',components:[{type:'text',attributes:{text:p.footer}}]});
 if(p.buttons.length){
  components.push({type:'buttons',components:p.buttons.map((b,i)=>({
   type:'button',attributes:{buttonType:b.type,text:b.text},
   parameters:p.variables.filter(v=>v.part==='button'&&v.buttonIndex===i).map((v,j)=>({name:'parameter_'+j}))
  }))});
 }
 return {components};
}
test('library includes exactly twelve unique, valid Meta names and three per segment',()=>{
 assert.equal(TEMPLATE_LIBRARY.length,12);
 assert.equal(new Set(TEMPLATE_LIBRARY.map(x=>x.id)).size,12);
 assert.equal(new Set(TEMPLATE_LIBRARY.map(x=>x.name)).size,12);
 for(const segment of ['automotive','clinic','pet','custom'])
  assert.equal(TEMPLATE_LIBRARY.filter(p=>p.segment===segment).length,3);
 for(const p of TEMPLATE_LIBRARY){
  assert.match(p.name,/^[a-z0-9_]+$/);
  assert.equal(p.languageCode,'pt_BR');
  assert.equal(p.suggestedCategory,'UTILITY');
  assert.ok([1,3,30].includes(p.suggestedOffsetDays));
  const indexes=Array.from(p.body.matchAll(/\{\{(\d+)\}\}/g),m=>Number(m[1]));
  assert.deepEqual(indexes,p.variables.filter(v=>v.part==='body').map(v=>v.position),p.id);
  if(p.header?.type==='TEXT'){
   assert.deepEqual(Array.from((p.header.text||'').matchAll(/\{\{(\d+)\}\}/g),m=>Number(m[1])),
    p.variables.filter(v=>v.part==='header').map(v=>v.position));
  }
 }
 assert.equal(findPreset('__unknown__'),null);
});
test('all catalog entries match their equivalent synced GoTo definition',()=>{
 for(const p of TEMPLATE_LIBRARY){
  const mapping=suggestMapping(p,mockGoto(p));
  assert.equal(mapping.compatible,true,p.id+': '+mapping.issues.join('; '));
  assert.equal(Object.keys(mapping.suggested).length,p.variables.length,p.id);
  assert.deepEqual(mapping.manualFields,p.variables.filter(v=>v.manual).map(v=>v.label));
  assert.equal(mapping.requiredMedia,!!(p.header&&p.header.type!=='TEXT'));
  assert.equal(mapping.suggested['body.parameter_0'],p.variables.find(v=>v.part==='body')?.selector);
 }
});
test('a template with reordered buttons or different body fails compatibility',()=>{
 const p=findPreset('auto_revisao_3d')!;
 const changed=mockGoto(p);
 changed.components.find((x:any)=>x.type==='buttons').components[0].attributes.buttonType='URL';
 assert.equal(suggestMapping(p,changed).compatible,false);
 const other=mockGoto(p);
 other.components.find((x:any)=>x.type==='body').components[0].attributes.text='Uma mensagem diferente {{1}}';
 assert.equal(suggestMapping(p,other).compatible,false);
 const noImage=mockGoto(p);
 noImage.components=noImage.components.filter((x:any)=>x.type!=='header');
 assert.equal(suggestMapping(p,noImage).compatible,false);
});
test('mapping uses actual GoTo keys and keeps existing administrator choices',()=>{
 const p=findPreset('auto_retirada_1d')!;
 const result=suggestMapping(p,mockGoto(p));
 assert.equal(result.suggested['buttons.0.parameter_0'],'event.custom.url_suffix');
 const existing={'body.parameter_0':'literal:Outro nome','header.media':'asset:tenant-owned'};
 const merged=mergePresetMapping(result.suggested,existing);
 assert.equal(merged['body.parameter_0'],'literal:Outro nome');
 assert.equal(merged['header.media'],'asset:tenant-owned');
 const overwrite=mergePresetMapping(result.suggested,existing,true);
 assert.equal(overwrite['body.parameter_0'],'contact.name');
 assert.equal(overwrite['header.media'],'asset:tenant-owned');
});
