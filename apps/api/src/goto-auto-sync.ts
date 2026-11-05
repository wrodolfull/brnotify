/** Account settings remain saved even if the external template-list API fails. */
export type AutoSyncResult=
 |{status:'success';count:number}
 |{status:'error';message:string};

export async function attemptAutomaticTemplateSync(run:()=>Promise<number>):Promise<AutoSyncResult>{
 try{return {status:'success',count:await run()}}
 catch(err){
  const description=err instanceof Error?err.message:'';
  const http=/GoTo HTTP\s+(\d{3})/.exec(description);
  const reason=http?.[1]||null;
  const message=reason==='401'
   ?'A GoTo recusou a autenticação (HTTP 401). Reconecte sua conta.'
   :reason==='403'
   ?'A GoTo recusou a consulta (HTTP 403). Verifique o acesso à caixa WhatsApp e o escopo messaging.v1.read.'
   :reason==='429'
   ?'A GoTo limitou as consultas (HTTP 429). Tente sincronizar novamente mais tarde.'
   :reason
   ?'A GoTo não conseguiu consultar os templates (HTTP '+reason+'). Tente novamente.'
   :'Não foi possível consultar os templates. Verifique a conexão e as permissões GoTo.';
  return {status:'error',message};
 }
}
