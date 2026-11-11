import crypto from 'node:crypto';
import {z} from 'zod';
import {query,audit} from './db.js';
import {supabase} from './auth.js';
import {FORCE_PASSWORD_CHANGE,needsPasswordChange} from './password-policy.js';

export const memberInput=z.object({
 name:z.string().trim().min(2).max(120),
 email:z.string().trim().email().transform(v=>v.toLowerCase()),
 role:z.enum(['admin','viewer'])
});
export const newPasswordInput=z.object({
 new_password:z.string().min(12,'Use pelo menos 12 caracteres').max(128)
  .refine(v=>/[A-Za-z]/.test(v)&&/[0-9]/.test(v),
   'Use letras e números na nova senha')
});

export function generateTemporaryPassword(){
 return crypto.randomBytes(24).toString('base64url');
}
const TEMP_PASSWORD_FINGERPRINT='brnotify_temporary_password_fingerprint';
const fingerprint=(password:string)=>crypto.createHash('sha256').update(password).digest('hex');

export async function createTenantMember(tenantId:string,actorId:string,input:z.infer<typeof memberInput>){
 // The existing Auth user might not have memberships yet. Never overwrite
 // an existing account's password merely because they join another tenant.
 const existing=await query('select id from auth.users where lower(email)=$1 limit 1',[input.email]);
 const existingId: string|undefined=existing.rows[0]?.id;
 let userId=existingId;
 let temporaryPassword:string|undefined;
 if(!userId){
  temporaryPassword=generateTemporaryPassword();
  const {data,error}=await supabase.auth.admin.createUser({
   email:input.email,password:temporaryPassword,email_confirm:true,
   user_metadata:{full_name:input.name},
   app_metadata:{[FORCE_PASSWORD_CHANGE]:true,[TEMP_PASSWORD_FINGERPRINT]:fingerprint(temporaryPassword)}
  });
  if(error||!data.user)throw new Error('Não foi possível criar a conta no Supabase Auth: '+(error?.message||'Erro desconhecido'));
  userId=data.user.id;
 }
 try{
  await query(
   'insert into tenant_members(tenant_id,user_id,email,role) values($1,$2,$3,$4) on conflict(tenant_id,user_id) do update set role=excluded.role,email=excluded.email',
   [tenantId,userId,input.email,input.role]
  );
 }catch(error){
  // Only roll back a brand-new Auth account: never delete an existing account.
  if(!existingId&&userId){
   const result=await supabase.auth.admin.deleteUser(userId);
   if(result.error)console.error('[members] Falha ao compensar criação de usuário');
  }
  throw error;
 }
 await audit(tenantId,actorId,existingId?'member.linked':'member.created',{email:input.email,role:input.role});
 return {email:input.email,role:input.role,created:!existingId,temporary_password:temporaryPassword??null};
}

export async function resetTenantMemberPassword(tenantId:string,userId:string,actorId:string){
 if(userId===actorId)throw new Error('Não é permitido redefinir a própria senha por este painel.');
 const member=await query('select email from tenant_members where tenant_id=$1 and user_id=$2',[tenantId,userId]);
 if(!member.rowCount)return null;
 const {data,error}=await supabase.auth.admin.getUserById(userId);
 if(error||!data.user)throw new Error('Usuário não encontrado no Supabase Auth');
 const temporaryPassword=generateTemporaryPassword();
 const {error:updateError}=await supabase.auth.admin.updateUserById(userId,{
  password:temporaryPassword,
  app_metadata:{...(data.user.app_metadata||{}),[FORCE_PASSWORD_CHANGE]:true,
   [TEMP_PASSWORD_FINGERPRINT]:fingerprint(temporaryPassword)}
 });
 if(updateError)throw new Error('Falha ao redefinir senha: '+updateError.message);
 await audit(tenantId,actorId,'member.password_reset',{user_id:userId});
 return {temporary_password:temporaryPassword,email:member.rows[0].email as string};
}

export async function finishFirstPasswordChange(userId:string,newPassword:string){
 const {data,error}=await supabase.auth.admin.getUserById(userId);
 if(error||!data.user)throw new Error('Não foi possível verificar sua conta');
 if(!needsPasswordChange(data.user.app_metadata))return false;
 // The temporary password is random and only its fingerprint is stored.
 // Prevent marking the first login complete without actually changing it.
 if(data.user.app_metadata?.[TEMP_PASSWORD_FINGERPRINT]===fingerprint(newPassword))return 'reused';
 const metadata={...(data.user.app_metadata||{}),[FORCE_PASSWORD_CHANGE]:false};
 delete metadata[TEMP_PASSWORD_FINGERPRINT];
 const {error:updateError}=await supabase.auth.admin.updateUserById(userId,{
  password:newPassword,app_metadata:metadata
 });
 if(updateError)throw new Error('Não foi possível atualizar a senha: '+updateError.message);
 return true;
}
