export type TenantPermissionActor={
 superAdmin:boolean;
 memberships:Array<{tenant_id:string;role:'admin'|'viewer'}>;
};
/** Never infer platform-level rights from a tenant's admin role. */
export function tenantRoleFor(actor:TenantPermissionActor|null|undefined,tenantId:string):'admin'|'viewer'|null{
 if(!actor)return null;
 if(actor.superAdmin===true)return 'admin';
 const member=actor.memberships.find(m=>m.tenant_id===tenantId);
 return member?.role==='admin'?'admin':member?.role==='viewer'?'viewer':null;
}
export function tenantPermitted(actor:TenantPermissionActor|null|undefined,tenantId:string,write=false):boolean{
 const role=tenantRoleFor(actor,tenantId);
 return role==='admin'||(!write&&role==='viewer');
}
