
import {supabase} from './auth.js';
import {query,pool} from './db.js';
async function main(){
 const email=process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
 const password=process.env.BOOTSTRAP_PASSWORD||'';
 if(!email||password.length<12)throw new Error('Configure BOOTSTRAP_EMAIL e BOOTSTRAP_PASSWORD com 12+ caracteres');
 const {data,error}=await supabase.auth.admin.createUser({email,password,email_confirm:true});
 if(error||!data.user)throw new Error(error?.message||'Falha no bootstrap. Se o usuário existe, atribua manualmente a plataforma após validação.');
 await query('insert into platform_admins(user_id) values($1)',[data.user.id]);
 console.log('Super Admin criado:',email);
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
