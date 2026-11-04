import {createContext,useContext} from 'react';
import type {Actor,Requester} from './api';
export type AppContextType={
 actor:Actor;tenantId:string;tenantName:string;segment:string;role:'admin'|'viewer';isSuper:boolean;
 api:Requester;selectTenant:(id:string)=>void;notify:(text:string,kind?:'success'|'error')=>void;refresh:()=>Promise<void>;
};
export const AppContext=createContext<AppContextType|null>(null);
export function useApp(){
 const ctx=useContext(AppContext);
 if(!ctx)throw new Error('AppContext não inicializado');
 return ctx;
}
