import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {Readable} from 'node:stream';
if(!process.env.CI_DATABASE_URL?.includes('127.0.0.1'))
 throw new Error('Teste exige banco PostgreSQL local da CI');
process.env.DATABASE_URL=process.env.CI_DATABASE_URL;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-placeholder';
process.env.TOKEN_ENCRYPTION_KEY='0'.repeat(64);
const {pool,query,pageParams}=await import('../src/db.js');
const {setContactsActive,removeContacts,removeEvent,removeTenant}=await import('../src/lifecycle.js');
const {importContacts}=await import('../src/contact-import.js');
const {ApiOperationError}=await import('../src/external-operations.js');

type Reply={status:(n:number)=>Reply;json:(x:any)=>Reply;data?:any;code?:number};
function makeReply():Reply{
 return {status(n){this.code=n;return this},json(data){this.data=data;return this}};
}
function mockFile(rows:string[][]):any{
 const buffer=Buffer.from(rows.map(r=>r.join(';')).join('\n'),'utf8');
 return {originalname:'contacts.csv',buffer,size:buffer.length,mimetype:'text/csv'};
}
const unique='lc-'+Math.random().toString(36).slice(2,9);
const t=(await query('insert into tenants(name,slug,segment) values($1,$2,$3) returning id',
 ['Teste Lifecycle',unique,'custom'])).rows[0].id;
const other=(await query('insert into tenants(name,slug,segment) values($1,$2,$3) returning id',
 ['Outro Lifecycle',unique+'other','custom'])).rows[0].id;
try{
 assert.deepEqual(pageParams(1),{page:1,limit:50,offset:0});
 assert.deepEqual(pageParams(3),{page:3,limit:50,offset:100});

 const csv=mockFile([
  ['nome','whatsapp','email','consentimento','origem_consentimento'],
  ['Contato 1','+5519999999999','','SIM','Autorização em balcão'],
  ['Contato 2','+5519888888888','','NÃO',''],
  ['Contato 1 repetido','+5519999999999','','SIM','Autorização em balcão']
 ]);
 const req={tenantId:t,file:csv} as any;
 const preview=makeReply();
 await importContacts(req,preview as any,true);
 assert.equal(preview.data.total,3);
 assert.equal(preview.data.valid,2);
 assert.equal(preview.data.duplicates_in_file,1);
 const created=makeReply();
 await importContacts(req,created as any,false);
 assert.equal(created.data.imported,2);
 const repeated=makeReply();
 await importContacts(req,repeated as any,false);
 assert.equal(repeated.data.imported,0);
 assert.equal(repeated.data.existing,2);
 assert.equal((await query('select count(*)::int n from events where tenant_id=$1',[t])).rows[0].n,0,
  'Contact import cannot create appointments');
 const c=(await query('select id from contacts where tenant_id=$1 and phone=$2',[t,'+5519999999999'])).rows[0].id;
 const no=(await query('select consent from contacts where tenant_id=$1 and phone=$2',[t,'+5519888888888'])).rows[0];
 assert.equal(no.consent,false);
 const event=(await query("insert into events(tenant_id,contact_id,title,starts_at) values($1,$2,'Checkup',now()+interval '15 days') returning id",[t,c])).rows[0].id;
 const msg=(await query("insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at) values($1,$2,1,now()+interval '2 days') returning id",[t,event])).rows[0].id;
 const originalConsent=(await query('select consent from contacts where id=$1',[c])).rows[0].consent;
 await assert.rejects(()=>setContactsActive(other,[c],false),(e:unknown)=>e instanceof ApiOperationError&&e.code===404);
 const off=await setContactsActive(t,[c],false);
 assert.equal(off.updated,1);
 assert.equal(off.cancelled_reminders,1);
 assert.equal((await query('select is_active,consent from contacts where id=$1',[c])).rows[0].is_active,false);
 assert.equal((await query('select consent from contacts where id=$1',[c])).rows[0].consent,originalConsent,
  'Deactivation must not change consent');
 assert.equal((await query('select status from scheduled_messages where id=$1',[msg])).rows[0].status,'cancelled');
 await setContactsActive(t,[c],true);
 assert.equal((await query('select status from scheduled_messages where id=$1',[msg])).rows[0].status,'cancelled',
  'Re-activation cannot silently requeue previous WhatsApp messages');
 const rec=(await query("update scheduled_messages set status='scheduled' where id=$1 returning id",[msg])).rows[0];
 assert.ok(rec);
 const deleted=await removeEvent(t,event);
 assert.equal(deleted.deleted,true);
 assert.equal(deleted.cancelled_reminders,1);
 assert.equal((await query('select count(*)::int n from scheduled_messages where id=$1',[msg])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from events where id=$1',[event])).rows[0].n,0);

 const secondEvent=(await query("insert into events(tenant_id,contact_id,title,starts_at) values($1,$2,'Revisão',now()+interval '14 days') returning id",[t,c])).rows[0].id;
 const inFlight=(await query("insert into scheduled_messages(tenant_id,event_id,slot,scheduled_at,status) values($1,$2,1,now()+interval '2 days','processing') returning id",[t,secondEvent])).rows[0].id;
 await assert.rejects(()=>removeContacts(t,[c]),(e:unknown)=>e instanceof ApiOperationError&&e.code===409);
 await query("update scheduled_messages set status='scheduled' where id=$1",[inFlight]);
 await assert.rejects(()=>removeContacts(other,[c]),(e:unknown)=>e instanceof ApiOperationError&&e.code===404);
 const gone=await removeContacts(t,[c]);
 assert.equal(gone.deleted,1);
 assert.equal((await query('select count(*)::int n from contacts where id=$1',[c])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from events where id=$1',[secondEvent])).rows[0].n,0);
 const otherC=(await query("insert into contacts(tenant_id,name,phone) values($1,'Outro contato','+5519777777777') returning id",[other])).rows[0].id;
 const result=await removeTenant(t);
 assert.equal(result.deleted,true);
 assert.equal((await query('select count(*)::int n from tenants where id=$1',[t])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from contacts where id=$1',[otherC])).rows[0].n,1);

 // Test max rows with a full-sized CSV; this must not import or request a DB operation.
 const buf=Readable.from(['nome;whatsapp\n',...Array.from({length:10001},(_,i)=>
  'Contato '+i+';+551'+String(8000000000+i).padStart(10,'0')+'\n')]);
 const pieces:Buffer[]=[];
 for await(const piece of buf)pieces.push(Buffer.from(piece));
 const big=Buffer.concat(pieces);
 const rejected=makeReply();
 await assert.rejects(
  ()=>importContacts({tenantId:other,file:{originalname:'large.csv',buffer:big,size:big.length}} as any,rejected as any,true),
  (e:unknown)=>e instanceof ApiOperationError&&e.code===422
 );
 console.log('Contact CSV deduplication, opt-in/opt-out, archive, bulk deletion, event cancellation, tenant isolation, 50 pagination and 10k limit validated');
}finally{
 await query('delete from tenants where id=$1',[other]);
 await pool.end();
}
