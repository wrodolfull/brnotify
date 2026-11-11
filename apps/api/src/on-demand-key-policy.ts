/** Match the public API key authentication rule for the asynchronous URA worker.
 * NULL expires_at means a deliberately non-expiring, messages:send-only key.
 * Absent/revoked keys and keys whose expiry has passed must still be refused.
 */
export type DispatchKeyState={
 source:string|null|undefined;
 api_key_id:string|null|undefined;
 token_revoked_at:string|Date|null|undefined;
 token_expires_at:string|Date|null|undefined;
};
export function isOnDemandKeyValid(job:DispatchKeyState,now=Date.now()):boolean{
 if(job.source==='panel'||job.source==='automation')return true;
 if(!job.api_key_id || job.token_revoked_at != null)return false;
 if(job.token_expires_at===null)return true;
 if(job.token_expires_at===undefined)return false;
 return new Date(job.token_expires_at).getTime()>now;
}
