import crypto from 'node:crypto';
import {Router} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {query,pageParams,audit} from './db.js';
import {authenticate,tenant,activeTenant,supabase,wrap} from './auth.js';

export const MEDIA_BUCKET='brnotify-goto-media';
export const MAX_MEDIA_BYTES=16*1024*1024;
const allowed={
 'image/jpeg':{ext:'jpg',kind:'image',max:5*1024*1024},
 'image/png':{ext:'png',kind:'image',max:5*1024*1024},
 'image/webp':{ext:'webp',kind:'image',max:5*1024*1024},
 'video/mp4':{ext:'mp4',kind:'video',max:16*1024*1024},
 'application/pdf':{ext:'pdf',kind:'document',max:16*1024*1024}
} as const;
export type AllowedMime=keyof typeof allowed;
export type MediaAttachment={filename:string;contentType:AllowedMime;bytes:Buffer};
export function inspectMedia(buffer:Buffer,mime:string){
 const sig=(start:number,count:number)=>buffer.subarray(start,start+count).toString('hex');
 const isJpeg=sig(0,3)==='ffd8ff';
 const isPng=sig(0,8)==='89504e470d0a1a0a';
 const isWebp=buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
 const isMp4=buffer.subarray(4,8).toString()==='ftyp';
 const isPdf=buffer.subarray(0,5).toString()==='%PDF-';
 const valid=mime==='image/jpeg'?isJpeg:mime==='image/png'?isPng:
  mime==='image/webp'?isWebp:mime==='video/mp4'?isMp4:mime==='application/pdf'?isPdf:false;
 if(!valid||!(mime in allowed))throw new Error('Formato inválido ou conteúdo não corresponde ao tipo de mídia');
 const settings=allowed[mime as AllowedMime];
 if(buffer.length===0||buffer.length>settings.max)throw new Error('Arquivo excede o limite permitido para este formato');
 return {mime:mime as AllowedMime,...settings};
}
export function validateMediaTypeForTemplate(contentType:AllowedMime,componentType:string){
 if(allowed[contentType].kind!==componentType)
  throw new Error('A mídia selecionada não corresponde ao tipo exigido pelo cabeçalho do template');
}
export async function downloadTenantMedia(tenantId:string,assetId:string,requiredType:string):Promise<MediaAttachment>{
 const id=z.string().uuid().parse(assetId);
 const row=await query(
  'select id,storage_path,content_type,size_bytes from goto_media_assets where id=$1 and tenant_id=$2',
  [id,tenantId]
 );
 if(!row.rowCount)throw new Error('Mídia não encontrada neste ambiente');
 const data=row.rows[0];
 const type=data.content_type as AllowedMime;
 validateMediaTypeForTemplate(type,requiredType);
 const {data:blob,error}=await supabase.storage.from(MEDIA_BUCKET).download(data.storage_path);
 if(error||!blob)throw new Error('Não foi possível obter a mídia privada do Supabase');
 if(blob.size>MAX_MEDIA_BYTES||blob.size!==Number(data.size_bytes))throw new Error('Tamanho do arquivo de mídia inesperado');
 const bytes=Buffer.from(await blob.arrayBuffer());
 inspectMedia(bytes,type);
 return {filename:'brnotify-'+data.id+'.'+allowed[type].ext,contentType:type,bytes};
}
const memory=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:MAX_MEDIA_BYTES}});
export const mediaRouter=Router();
mediaRouter.use(authenticate);
mediaRouter.get('/',tenant(),wrap(async(req,res)=>{
 const page=pageParams(req.query.page);
 const [rows,count]=await Promise.all([
  query('select id,label,original_name,content_type,size_bytes,created_at from goto_media_assets where tenant_id=$1 order by created_at desc limit 20 offset $2',[req.tenantId,page.offset]),
  query('select count(*)::int n from goto_media_assets where tenant_id=$1',[req.tenantId])
 ]);
 res.json({items:rows.rows,total:count.rows[0].n,page:page.page,pages:Math.ceil(count.rows[0].n/20)});
}));
mediaRouter.post('/',tenant(true),activeTenant,memory.single('file'),wrap(async(req,res)=>{
 if(!req.file)return res.status(422).json({error:'Selecione uma imagem, vídeo ou PDF'});
 let settings;
 try{settings=inspectMedia(req.file.buffer,req.file.mimetype)}
 catch(e){return res.status(422).json({error:e instanceof Error?e.message:'Mídia inválida'})}
 const count=await query('select count(*)::int n from goto_media_assets where tenant_id=$1',[req.tenantId]);
 if(count.rows[0].n>=100)return res.status(409).json({error:'Limite de 100 mídias por ambiente'});
 const id=crypto.randomUUID();
 const name=req.file.originalname.normalize('NFKC').replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||('arquivo.'+settings.ext);
 const label=String(req.body?.label||name).trim().slice(0,120);
 if(!label)return res.status(422).json({error:'Informe um nome para a mídia'});
 const path=req.tenantId+'/'+id+'/file.'+settings.ext;
 const result=await supabase.storage.from(MEDIA_BUCKET).upload(path,req.file.buffer,{
  contentType:settings.mime,cacheControl:'3600',upsert:false
 });
 if(result.error)throw new Error('Falha ao gravar mídia no Supabase Storage: '+result.error.message);
 try{
  const row=await query(
   'insert into goto_media_assets(id,tenant_id,label,original_name,storage_path,content_type,size_bytes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,label,original_name,content_type,size_bytes,created_at',
   [id,req.tenantId,label,name,path,settings.mime,req.file.size,req.actor!.id]
  );
  await audit(req.tenantId!,req.actor!.id,'goto.media_uploaded',{assetId:id,contentType:settings.mime});
  res.status(201).json(row.rows[0]);
 }catch(err){
  await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  throw err;
 }
}));
mediaRouter.delete('/:id',tenant(true),activeTenant,wrap(async(req,res)=>{
 const id=z.string().uuid().parse(req.params.id);
 const asset=await query('select storage_path from goto_media_assets where id=$1 and tenant_id=$2',[id,req.tenantId]);
 if(!asset.rowCount)return res.status(404).json({error:'Mídia não encontrada'});
 const used=await query(
  "select 1 from message_templates where tenant_id=$1 and variable_map->>'header.media'=$2 limit 1",
  [req.tenantId,'asset:'+id]
 );
 if(used.rowCount)return res.status(409).json({error:'Mídia em uso em um template. Altere o mapeamento antes de excluir'});
 const {error}=await supabase.storage.from(MEDIA_BUCKET).remove([asset.rows[0].storage_path]);
 if(error)throw new Error('Não foi possível excluir a mídia no Storage');
 await query('delete from goto_media_assets where id=$1 and tenant_id=$2',[id,req.tenantId]);
 await audit(req.tenantId!,req.actor!.id,'goto.media_deleted',{assetId:id});
 res.status(204).end();
}));
