import {DateTime} from 'luxon';
import {z} from 'zod';

export const REPORT_KINDS=['all','message','appointment','confirmation','webhook','api','import'] as const;
export const REPORT_STATUSES=[
 'all','scheduled','processing','sent','delivered','failed','cancelled','unknown',
 'pending','not_requested','confirmed','reschedule_requested','declined',
 'queued','dead','success','partial','completed'
] as const;
export const reportFilterSchema=z.object({
 from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 kind:z.enum(REPORT_KINDS).default('all'),
 status:z.enum(REPORT_STATUSES).default('all'),
 q:z.string().trim().max(80).default(''),
 days:z.coerce.number().int().min(1).max(366).optional(),
 page:z.coerce.number().int().min(1).max(100000).default(1)
}).strict();

export type ReportFilter=z.infer<typeof reportFilterSchema>;
export type ReportWindow={
 from:string;to:string;startISO:string;endISO:string;zone:string;bucket:'day'|'week'|'month'
};
export function reportWindow(input:Pick<ReportFilter,'from'|'to'>,zone:string,now:DateTime=DateTime.now()):ReportWindow{
 const today=now.setZone(zone).startOf('day');
 if(!today.isValid)throw new Error('Fuso horário do ambiente inválido');
 const end=input.to?DateTime.fromISO(input.to,{zone}).startOf('day'):today;
 const start=input.from?DateTime.fromISO(input.from,{zone}).startOf('day'):end.minus({days:29});
 if(!start.isValid||!end.isValid||
  (input.from!==undefined&&start.toISODate()!==input.from)||
  (input.to!==undefined&&end.toISODate()!==input.to))
  throw new Error('Data inválida; utilize AAAA-MM-DD');
 const days=Math.round(end.diff(start,'days').days)+1;
 if(days<1||days>366)throw new Error('Selecione um período entre 1 e 366 dias');
 const bucket=days<=45?'day':days<=180?'week':'month';
 return {from:start.toISODate()!,to:end.toISODate()!,
  startISO:start.toUTC().toISO()!,endISO:end.plus({days:1}).toUTC().toISO()!,zone,bucket};
}
export function fillTrend(points:{period:string;sent:number;delivered:number;failed:number}[],window:ReportWindow){
 const first=DateTime.fromISO(window.from).startOf(window.bucket);
 const last=DateTime.fromISO(window.to).startOf(window.bucket);
 const values=new Map(points.map(p=>[p.period,p]));
 const result:{period:string;sent:number;delivered:number;failed:number}[]=[];
 for(let day=first;day<=last;day=day.plus({[window.bucket]:1})){
  const period=day.toISODate()!;
  result.push(values.get(period)||{period,sent:0,delivered:0,failed:0});
 }
 return result;
}
export function exportCsvCell(value:unknown){
 let s=String(value??'').replace(/\u0000/g,'');
 // Neutraliza fórmulas e whitespace de prefixo usados em CSV injection no Excel.
 if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
export function exportCsv(rows:unknown[][]){
 return '\uFEFFsep=;\r\n'+rows.map(row=>row.map(exportCsvCell).join(';')).join('\r\n')+'\r\n';
}
