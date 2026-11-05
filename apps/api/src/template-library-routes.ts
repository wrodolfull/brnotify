import {Router} from 'express';
import {z} from 'zod';
import {authenticate,tenant,activeTenant,wrap} from './auth.js';
import {query,audit} from './db.js';
import {TEMPLATE_LIBRARY,findPreset,suggestMapping,mergePresetMapping} from './template-library.js';

export const templateLibraryRouter=Router();
templateLibraryRouter.use(authenticate,tenant());
const segmentSchema=z.enum(['all','automotive','clinic','pet','custom']);
const idSchema=z.string().regex(/^[a-z0-9_]{4,70}$/);
const uuid=z.string().uuid();
function normalizedLang(value:string){
 return value.toLowerCase().replace(/-/g,'_');
}
templateLibraryRouter.get('/',wrap(async(req,res)=>{
 const segment=segmentSchema.parse(req.query.segment||'all');
 const q=z.string().trim().max(80).parse(req.query.q||'').toLocaleLowerCase('pt-BR');
 const result=TEMPLATE_LIBRARY.filter(p=>
  (segment==='all'||segment===p.segment)&&
  (!q||[p.title,p.description,p.name].some(v=>v.toLocaleLowerCase('pt-BR').includes(q)))
 );
 // 12 modelos agora; paginação fixa para futuras ampliações da biblioteca.
 const page=Math.max(1,Math.min(10000,Number.parseInt(String(req.query.page||'1'),10)||1));
 res.json({items:result.slice((page-1)*20,page*20),total:result.length,page,pages:Math.ceil(result.length/20)});
}));
templateLibraryRouter.get('/:id',wrap(async(req,res)=>{
 const preset=findPreset(idSchema.parse(req.params.id));
 if(!preset)return res.status(404).json({error:'Modelo não encontrado'});
 res.json(preset);
}));
async function findSyncedTemplate(tenantId:string,presetName:string,languageCode:string){
 return query(
  "select id,name,language_code,status,definition,variable_map from message_templates where tenant_id=$1 and name=$2 and lower(replace(language_code,'-','_'))=$3 order by updated_at desc limit 1",
  [tenantId,presetName,normalizedLang(languageCode)]
 );
}
templateLibraryRouter.get('/:id/match',wrap(async(req,res)=>{
 const preset=findPreset(idSchema.parse(req.params.id));
 if(!preset)return res.status(404).json({error:'Modelo não encontrado'});
 const row=await findSyncedTemplate(req.tenantId!,preset.name,preset.languageCode);
 if(!row.rowCount)return res.json({matched:false,reason:'Sincronize o modelo com o nome e idioma indicados após a aprovação na Meta.'});
 const tpl=row.rows[0],mapping=suggestMapping(preset,tpl.definition);
 res.json({matched:true,template:{id:tpl.id,name:tpl.name,language_code:tpl.language_code,status:tpl.status},
  ...mapping,current_mapping:tpl.variable_map||{},
  can_apply:tpl.status==='APPROVED'&&mapping.compatible});
}));
templateLibraryRouter.post('/:id/apply',tenant(true),activeTenant,wrap(async(req,res)=>{
 const preset=findPreset(idSchema.parse(req.params.id));
 if(!preset)return res.status(404).json({error:'Modelo não encontrado'});
 const input=z.object({template_id:uuid,overwrite:z.boolean().default(false)}).strict().parse(req.body);
 const row=await query(
  'select id,name,language_code,status,definition,variable_map from message_templates where id=$1 and tenant_id=$2',
  [input.template_id,req.tenantId]
 );
 if(!row.rowCount)return res.status(404).json({error:'Template não encontrado neste ambiente'});
 const tpl=row.rows[0];
 if(tpl.name!==preset.name||normalizedLang(tpl.language_code)!==normalizedLang(preset.languageCode))
  return res.status(409).json({error:'Nome ou idioma não correspondem ao modelo; confira o cadastro na Meta.'});
 if(tpl.status!=='APPROVED')return res.status(409).json({error:'Aguarde a aprovação do template na Meta/GoTo'});
 const match=suggestMapping(preset,tpl.definition);
 if(!match.compatible)return res.status(409).json({error:'Estrutura do template diferente do modelo sugerido',issues:match.issues});
 const existing:Record<string,string>=tpl.variable_map||{};
 const merged=mergePresetMapping(match.suggested,existing,input.overwrite);
 // Não escolhemos mídia de outra empresa: header.media continua pendente para o administrador.
 const updated=await query(
  'update message_templates set variable_map=$3,updated_at=now() where id=$1 and tenant_id=$2 returning id,name,variable_map',
  [tpl.id,req.tenantId,JSON.stringify(merged)]
 );
 await audit(req.tenantId!,req.actor!.id,'template_library.mapping_applied',{preset:preset.id,template_id:tpl.id,overwrite:input.overwrite});
 res.json({saved:updated.rows[0],required_media:match.requiredMedia,
  manual_fields:match.manualFields,
  preserved_existing:!input.overwrite,notice:'Confira os campos personalizados e a mídia antes de ativar os disparos.'});
}));
