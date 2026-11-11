import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const read=(file)=>readFileSync(resolve(root,file),'utf8');

test('Super Admin can delete tenants only after exact-name confirmation',()=>{
 const ui=read('apps/web/src/pages/Tenants.tsx');
 const routes=read('apps/api/src/routes.ts');
 assert.match(ui,/EXCLUSÃO PERMANENTE/);
 assert.match(ui,/typed!==t.name/);
 assert.match(ui,/method:'DELETE'/);
 assert.match(routes,/router.delete\('\/api\/tenants\/:id',requireSuper/);
 assert.match(routes,/input.confirm_name!==found.rows\[0\].name/);
});

test('appointments can be deleted and queued messages cancelled',()=>{
 const ui=read('apps/web/src/pages/Events.tsx');
 const routes=read('apps/api/src/routes.ts');
 const service=read('apps/api/src/lifecycle.ts');
 assert.match(ui,/Excluir compromisso/);
 assert.match(ui,/api\('\/api\/events\/'\+selected.id,\{method:'DELETE'\}\)/);
 assert.match(routes,/router.delete\('\/api\/events\/:id',tenant\(true\),activeTenant/);
 assert.match(service,/status='cancelled'/);
 assert.match(service,/delete from events where tenant_id=\$1 and id=\$2/);
});

test('new event has inline create contact and explicitly attested preselected WhatsApp consent',()=>{
 const events=read('apps/web/src/pages/Events.tsx');
 const contacts=read('apps/web/src/pages/Contacts.tsx');
 assert.match(events,/Criar novo contato/);
 assert.match(events,/const \[newConsent,setNewConsent\]=useState\(true\)/);
 assert.match(events,/api\('\/api\/contacts',\{method:'POST'/);
 assert.match(events,/setContactId\(c.id\)/);
 assert.match(contacts,/name="consent" defaultChecked/);
 assert.match(contacts,/Pré-selecionado para o cadastro manual/);
});

test('contact management supports active/inactive, bulk selections and 10k import',()=>{
 const ui=read('apps/web/src/pages/Contacts.tsx');
 const api=read('apps/api/src/routes.ts');
 const importer=read('apps/api/src/contact-import.ts');
 assert.match(ui,/Ativos/);
 assert.match(ui,/Inativos/);
 assert.match(ui,/Selecionar os \{visibleIds.length\} contatos desta página/);
 assert.match(ui,/api\('\/api\/contacts\/bulk',\{method:'DELETE'/);
 assert.match(ui,/\/api\/contacts\/import\/preview/);
 assert.match(api,/router.patch\('\/api\/contacts\/status',tenant\(true\),activeTenant/);
 assert.match(api,/router.delete\('\/api\/contacts\/bulk',tenant\(true\),activeTenant/);
 assert.match(importer,/MAX_CONTACT_IMPORT_ROWS=10000/);
 assert.match(importer,/on conflict\(tenant_id,phone\) do nothing/);
});

test('all paginated queries use a consistent 50-row server-side limit',()=>{
 const db=read('apps/api/src/db.ts');
 assert.match(db,/limit:50,offset:\(page-1\)\*50/);
 for(const file of ['routes.ts','automation-store.ts','goto-event-store.ts','goto-media.ts',
 'panel-notifications.ts','public-api.ts','template-library-routes.ts']){
  assert.doesNotMatch(read('apps/api/src/'+file),/limit 20 offset|Math.ceil\([^\n]+\/20\)/i,file);
 }
});
