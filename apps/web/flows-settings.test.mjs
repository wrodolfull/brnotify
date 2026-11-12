import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const read=(path)=>readFileSync(resolve(root,path),'utf8');

test('automation starter cards remain reachable after the first saved flow',()=>{
 const source=read('apps/web/src/pages/WorkflowAutomations.tsx');
 assert.match(source,/showExamples,setShowExamples/);
 assert.match(source,/aria-expanded=\{showExamples\}/);
 assert.match(source,/Ver modelos de automação/);
 assert.match(source,/\{showExamples&&<Card>/);
 assert.doesNotMatch(source,/!flows\.data\.items\.length&&<Card>/);
});
test('automation delete uses explicit confirmation and tenant-scoped authenticated endpoint',()=>{
 const ui=read('apps/web/src/pages/WorkflowAutomations.tsx');
 const routes=read('apps/api/src/routes.ts');
 const store=read('apps/api/src/automation-store.ts');
 assert.match(ui,/window\.confirm\('Excluir definitivamente a automação/);
 assert.match(ui,/method:'DELETE'/);
 assert.match(ui,/>Excluir<\/Button>/);
 assert.match(routes,/router\.delete\('\/api\/automation-flows\/:id',tenant\(true\),activeTenant/);
 assert.match(store,/where tenant_id=\$1 and id=\$2 for update/);
 assert.match(store,/cancelled_webhooks/);
});
test('GoTo disconnect is restricted to authorized tenant admin, confirms impact, and removes local credentials',()=>{
 const ui=read('apps/web/src/pages/Settings.tsx');
 const routes=read('apps/api/src/routes.ts');
 const service=read('apps/api/src/goto-disconnect.ts');
 assert.match(ui,/Desconectar GoTo/);
 assert.match(ui,/method:'DELETE'/);
 assert.match(ui,/não revoga automaticamente a autorização no portal GoTo/);
 assert.match(routes,/router\.delete\('\/api\/goto',tenant\(true\),activeTenant/);
 assert.match(service,/delete from goto_connections where tenant_id=\$1/);
 assert.match(service,/update automation_flows set status='paused'/);
 assert.match(service,/provider_authorization_revoked:false/);
});

test('one-click GoTo inbound setup is tenant protected and supports webhook verification',()=>{
 const ui=read('apps/web/src/pages/Settings.tsx');
 const routes=read('apps/api/src/routes.ts');
 const service=read('apps/api/src/goto-message-notifications.ts');
 assert.match(ui,/Ativar recebimento de respostas/);
 assert.match(ui,/\/api\/goto\/notifications\/activate/);
 assert.match(ui,/Configuração manual \(avançado\)/);
 assert.match(routes,/router\.post\('\/api\/goto\/notifications\/activate',tenant\(true\),activeTenant/);
 assert.match(routes,/router\.options\('\/api\/webhooks\/goto\/:secret'/);
 assert.match(routes,/Object\.keys\(req\.body\)\.length/);
 assert.match(service,/INBOUND_MESSAGE/);
 assert.match(service,/DELIVERY_STATUS/);
 assert.match(service,/pg_try_advisory_lock/);
});
