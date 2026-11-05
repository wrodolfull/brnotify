import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DateTime} from 'luxon';
import {reportWindow,fillTrend,exportCsv,reportFilterSchema} from './reports-utils.js';

test('reports use tenant timezone and exclusive end-date, even across DST',()=>{
 const window=reportWindow({from:'2026-11-01',to:'2026-11-04'},'America/Sao_Paulo',DateTime.fromISO('2026-11-04T12:00:00Z'));
 assert.equal(window.startISO,'2026-11-01T03:00:00.000Z');
 assert.equal(window.endISO,'2026-11-05T03:00:00.000Z');
 assert.equal(window.bucket,'day');
});
test('reports reject inverted and too long ranges',()=>{
 assert.throws(()=>reportWindow({from:'2026-12-10',to:'2026-12-01'},'America/Sao_Paulo'));
 assert.throws(()=>reportWindow({from:'2024-01-01',to:'2026-11-04'},'America/Sao_Paulo'));
 assert.throws(()=>reportWindow({from:'2026-02-30',to:'2026-03-01'},'America/Sao_Paulo'));
});
test('reports choose weekly and monthly buckets for longer periods',()=>{
 assert.equal(reportWindow({from:'2026-01-01',to:'2026-03-01'},'UTC').bucket,'week');
 assert.equal(reportWindow({from:'2026-01-01',to:'2026-09-01'},'UTC').bucket,'month');
});
test('trend fills missing buckets without inventing values',()=>{
 const window=reportWindow({from:'2026-11-01',to:'2026-11-03'},'UTC');
 const data=fillTrend([{period:'2026-11-02',sent:3,delivered:2,failed:1}],window);
 assert.deepEqual(data.map(p=>p.sent),[0,3,0]);
 assert.deepEqual(data.map(p=>p.delivered),[0,2,0]);
});
test('filters reject unexpected params and bad statuses',()=>{
 assert.equal(reportFilterSchema.safeParse({status:'hacked',page:1}).success,false);
 assert.equal(reportFilterSchema.safeParse({tenant_id:'other-tenant'}).success,false);
});
test('CSV escapes delimiters, quotes, newlines, formula injection and unicode',()=>{
 const csv=exportCsv([['Nome','Placa'],['José; "x"','=CMD("foo")'],['+SUM(A1:A2)','ABC1D23']]);
 assert.ok(csv.startsWith('\uFEFFsep=;\r\n'));
 assert.ok(csv.includes('"José; ""x"""'));
 assert.ok(csv.includes('"\'=CMD(""foo"")"'));
 assert.ok(csv.includes('"\'+SUM(A1:A2)"'));
});
