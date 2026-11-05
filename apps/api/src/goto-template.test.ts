import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused:unused@127.0.0.1:5432/postgres';
process.env.SUPABASE_URL||='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY||='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY||='0'.repeat(64);
const {buildTemplatePayload,resolveTemplateMediaId,templateFields}=await import('./goto-template.js');
const {inspectMedia,validateMediaTypeForTemplate}=await import('./goto-media.js');
const {buildMessagingForm}=await import('./goto.js');

const uuid='21dcd3e1-1eb7-4696-8151-2ef26c917488';
const ctx={
 contact:{name:'Carlos Silva',phone:'+5519999999999',custom_data:{ref:'C-123'}},
 event:{title:'Revisão',event_type:'revisao',starts_at:'2026-12-15T12:00:00.000Z',timezone:'America/Sao_Paulo',details:{}},
 record:{details:{model:'Corolla',plate:'ABC1D23',media_asset_id:uuid}}
};
const standard={
 name:'order_shipped',language_code:'en_US',status:'APPROVED',
 definition:{components:[
  {type:'header',components:[{type:'text',attributes:{text:'Update for {{store_name}}'},parameters:[{name:'store_name'}]}]},
  {type:'body',components:[{type:'text',attributes:{text:'Hello {{customer_name}}, order {{order_id}}'},parameters:[{name:'customer_name'},{name:'order_id'}]}]},
  {type:'footer',components:[{type:'text',attributes:{text:'Reply STOP'}}]},
  {type:'buttons',components:[
   {type:'button',attributes:{buttonType:'URL',text:'Track Order'},parameters:[{name:'tracking_code'}]},
   {type:'button',attributes:{buttonType:'QUICK_REPLY',text:'Contact Support'}}
  ]}
 ]},
 variable_map:{
  'header.store_name':'literal:GoTo Shop',
  'body.customer_name':'contact.name',
  'body.order_id':'literal:98765',
  'buttons.0.tracking_code':'contact.custom.ref'
 }
};
test('builds GoTo v2 documented header/body/buttons structure with URL parameter',()=>{
 const value=buildTemplatePayload(standard,ctx.contact,ctx.event,ctx.record,'137169456416846');
 assert.equal(value.attributes.languageCode,'en_US');
 assert.deepEqual(value.components,[
  {type:'header',parameters:[{name:'store_name',value:'GoTo Shop'}]},
  {type:'body',parameters:[{name:'customer_name',value:'Carlos Silva'},{name:'order_id',value:'98765'}]},
  {type:'buttons',components:[{type:'button',parameters:[{name:'tracking_code',value:'C-123'}]}]}
 ]);
 const keys=templateFields(standard.definition).map(x=>x.key);
 assert.deepEqual(keys,['header.store_name','body.customer_name','body.order_id','buttons.0.tracking_code']);
});
test('resolves tenant-local media ID and builds a real image attachment header',()=>{
 const image={
  name:'shipping_update',language_code:'pt_BR',status:'APPROVED',
  definition:{components:[
   {type:'header',components:[{type:'image',attributes:{attachmentName:null}}]},
   {type:'body',components:[{type:'text',parameters:[{name:'parameter_0'}]}]}
  ]},
  variable_map:{'header.media':'record.media_asset_id','body.parameter_0':'record.model'}
 };
 assert.deepEqual(resolveTemplateMediaId(image,ctx),{assetId:uuid,kind:'image'});
 const payload=buildTemplatePayload(image,ctx.contact,ctx.event,ctx.record,'137169456416846','brnotify-image.jpg');
 assert.deepEqual(payload.components,[
  {type:'header',components:[{type:'image',attributes:{attachmentName:'brnotify-image.jpg'}}]},
  {type:'body',parameters:[{name:'parameter_0',value:'Corolla'}]}
 ]);
 assert.throws(()=>buildTemplatePayload(image,ctx.contact,ctx.event,ctx.record,'137169456416846'),/Arquivo exigido/);
});
test('supports video and document media headers plus static quick replies',()=>{
 for(const kind of ['video','document']){
  const template={
   name:'demo',language_code:'pt_BR',status:'APPROVED',
   definition:{components:[{type:'header',components:[{type:kind,attributes:{attachmentName:null}}]},{type:'buttons',components:[{type:'button',attributes:{buttonType:'QUICK_REPLY',text:'Confirmar'}}]}]},
   variable_map:{'header.media':'asset:'+uuid}
  };
  assert.deepEqual(resolveTemplateMediaId(template,ctx),{assetId:uuid,kind});
  const payload=buildTemplatePayload(template,ctx.contact,ctx.event,ctx.record,'137169456416846','media-file');
  assert.equal(payload.components?.length,1);
 }
});
test('rejects media type mismatch, unsafe files, and unapproved templates',()=>{
 const jpeg=Buffer.from([0xff,0xd8,0xff,0x00]);
 assert.equal(inspectMedia(jpeg,'image/jpeg').kind,'image');
 const pdf=Buffer.from('%PDF-1.7');
 assert.equal(inspectMedia(pdf,'application/pdf').kind,'document');
 assert.throws(()=>inspectMedia(jpeg,'application/pdf'));
 assert.throws(()=>inspectMedia(Buffer.from('<svg />'),'image/svg+xml'));
 assert.throws(()=>validateMediaTypeForTemplate('application/pdf','image'));
 assert.throws(()=>buildTemplatePayload({...standard,status:'PENDING'},ctx.contact,ctx.event,ctx.record,'1'));
});
test('multipart includes request.json and attachment binary, preserving filename',()=>{
 const attachment={filename:'receipt.jpg',contentType:'image/jpeg' as const,bytes:Buffer.from([0xff,0xd8,0xff,0x00])};
 const form=buildMessagingForm({channel:'WHATSAPP'},[attachment]);
 const request=form.get('request');
 assert.ok(request && typeof request!=='string');
 assert.equal(request.name,'request.json');
 assert.equal(request.type,'application/json');
 const file=form.get('attachments');
 assert.ok(file && typeof file!=='string');
 assert.equal(file.name,'receipt.jpg');
 assert.equal(file.type,'image/jpeg');
});
test('repeated parameter names in body and button map to different fields',()=>{
 const template={
  ...standard,
  definition:{components:[
   {type:'body',components:[{type:'text',parameters:[{name:'parameter_0'}]}]},
   {type:'buttons',components:[{type:'button',parameters:[{name:'parameter_0'}]}]}
  ]},
  variable_map:{'body.parameter_0':'contact.name','buttons.0.parameter_0':'record.plate'}
 };
 const payload=buildTemplatePayload(template,ctx.contact,ctx.event,ctx.record,'137169456416846');
 assert.deepEqual(payload.components,[
  {type:'body',parameters:[{name:'parameter_0',value:'Carlos Silva'}]},
  {type:'buttons',components:[{type:'button',parameters:[{name:'parameter_0',value:'ABC1D23'}]}]}
 ]);
});

test('buildTemplatePayload uses E.164 and rejects malformed recipient before provider request',()=>{
 const template={name:'reminder',language_code:'pt_BR',status:'APPROVED',definition:{components:[]},variable_map:{}};
 const contact={name:'Test',phone:'(19) 99999-9999'};
 const payload=buildTemplatePayload(template,contact,{},null,'137169456416846');
 assert.deepEqual(payload.to,['+5519999999999']);
 assert.throws(()=>buildTemplatePayload(template,{...contact,phone:'+5509999999999'}, {},null,'137169456416846'),/WhatsApp/);
});

test('formato nacional e +55 produzem o mesmo payload GoTo',()=>{
 const model={name:'reminder',language_code:'pt_BR',status:'APPROVED',definition:{components:[]},variable_map:{}};
 const from='137169456416846';
 const national=buildTemplatePayload(model,{name:'Contato',phone:'19982714339'}, {},null,from);
 const international=buildTemplatePayload(model,{name:'Contato',phone:'+5519982714339'}, {},null,from);
 assert.deepEqual(national,international);
 assert.deepEqual(national.to,['+5519982714339']);
});
