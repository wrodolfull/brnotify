// Browser-memory cache only. Keys include user and tenant so switching workspaces
// never reuses another account's or environment's data.
type Entry = {value:unknown;updatedAt:number};
const entries=new Map<string,Entry>();
const pending=new Map<string,Promise<unknown>>();
const DEFAULT_MAX_AGE=30_000;
const MAX_ENTRIES=160;
let generation=0;

export const queryScope=(userId:string,tenantId:string)=>JSON.stringify([userId,tenantId])+'|';
export const queryKey=(userId:string,tenantId:string,path:string)=>queryScope(userId,tenantId)+path;

export function peekQuery<T>(key:string):T|undefined{
 const found=entries.get(key);
 if(!found)return undefined;
 // Refresh insertion order to approximate LRU, including stale entries.
 entries.delete(key);entries.set(key,found);
 return found.value as T;
}

export function loadQuery<T>(key:string,request:()=>Promise<T>,force=false,maxAgeMs=DEFAULT_MAX_AGE):Promise<T>{
 const cached=entries.get(key);
 if(!force&&cached&&Date.now()-cached.updatedAt<maxAgeMs)return Promise.resolve(cached.value as T);
 const inflight=pending.get(key);
 if(inflight)return inflight as Promise<T>;
 const startedAt=generation;
 const operation=request().then(result=>{
  if(generation===startedAt){
   entries.delete(key);
   entries.set(key,{value:result,updatedAt:Date.now()});
   if(entries.size>MAX_ENTRIES)entries.delete(entries.keys().next().value!);
  }
  return result;
 });
 const tracked=operation.finally(()=>{
  if(pending.get(key)===tracked)pending.delete(key);
 });
 pending.set(key,tracked);
 return tracked;
}

export function invalidateQueryScope(scope:string){
 generation++;
 for(const key of entries.keys())if(key.startsWith(scope))entries.delete(key);
 for(const key of pending.keys())if(key.startsWith(scope))pending.delete(key);
}

export function clearQueryCache(){
 generation++;
 entries.clear();pending.clear();
}
