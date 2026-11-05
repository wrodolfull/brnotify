import {pageParams,query} from './db.js';

export type TenantListActor={id:string;superAdmin:boolean};
type QueryExecutor=(sql:string,params:unknown[])=>Promise<{rows:any[]}>;
const visibleJoin=[
 'from tenants t',
 'left join tenant_members m on m.tenant_id=t.id and m.user_id=$1',
 'where ($2::boolean or m.user_id is not null)'
].join(' ');

const tenantFields=[
 't.id,t.name,t.slug,t.segment,t.timezone,t.status,t.created_at',
 "case when $2::boolean then 'admin'::text else m.role end as role"
].join(',');

/** Super Admin sees every tenant; all other users see membership-authorized tenants only. */
export async function listVisibleTenants(
 actor:TenantListActor,pageInput:unknown,run:QueryExecutor=query
){
 const p=pageParams(pageInput);
 const [list,total]=await Promise.all([
  run(
   'select '+tenantFields+' '+visibleJoin+
   ' order by t.created_at desc,t.id desc limit $3 offset $4',
   [actor.id,actor.superAdmin,p.limit,p.offset]
  ),
  run('select count(*)::int as total '+visibleJoin,[actor.id,actor.superAdmin])
 ]);
 const count=Number(total.rows[0]?.total||0);
 return {items:list.rows,total:count,page:p.page,pages:Math.ceil(count/p.limit)};
}

/** Complete authorized set for the workspace switcher; not tied to paginated admin listings. */
export async function listTenantOptions(
 actor:TenantListActor,run:QueryExecutor=query
){
 const result=await run(
  'select t.id,t.name,t.segment,t.status,'+
  "case when $2::boolean then 'admin'::text else m.role end as role "+
  visibleJoin+' order by t.name asc,t.id asc',
  [actor.id,actor.superAdmin]
 );
 return {items:result.rows};
}
