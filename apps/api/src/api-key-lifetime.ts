import {z} from 'zod';
import {scopesSchema} from './integration-keys.js';

/** Only URA-only keys may be permanent; all broader tokens expire. */
export const apiKeyCreationSchema=z.object({
 label:z.string().trim().min(2).max(80),
 scopes:scopesSchema,
 expires_in_days:z.number().int().min(1).max(365).nullable().default(90)
}).superRefine((value,ctx)=>{
 if(value.expires_in_days===null&&(
  value.scopes.length!==1||value.scopes[0]!=='messages:send'
 )){
  ctx.addIssue({
   code:z.ZodIssueCode.custom,path:['expires_in_days'],
   message:'Somente tokens exclusivos da URA (messages:send) podem não expirar.'
  });
 }
});

