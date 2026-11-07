import {useState,type ChangeEvent} from 'react';
import {Download,FileSpreadsheet,UploadCloud,CheckCircle2,AlertCircle,FileWarning} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,Empty,ErrorHint,PageTitle,useList,Pagination} from '../components';
import {fmtDate} from '../api';
export function Imports(){
 const {api,role,notify}=useApp(),canEdit=role==='admin';
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<any>(null),[result,setResult]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const history=useList('/api/imports');
 async function download(){try{const blob=await api('/api/imports/template');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='brnotify-modelo.xlsx';a.click();URL.revokeObjectURL(url)}catch(e:any){notify(e.message,'error')}}
 async function send(dry:boolean){
  if(!file)return;setBusy(true);setError('');
  try{
   const form=new FormData();form.append('file',file);
   const data=await api(dry?'/api/imports/preview':'/api/imports',{method:'POST',body:form});
   if(dry){setPreview(data);setResult(null)}else{setResult(data);setPreview(null);history.refresh();notify('Importação finalizada')}
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <><PageTitle eyebrow="COMPROMISSOS" title="Importar compromissos" subtitle="Carregue contatos e seus compromissos com data marcada. Para envios avulsos, use Notificações." action={<Button secondary onClick={download}><Download size={17}/> Baixar modelo Excel</Button>}/>
 <div className="import-grid"><Card><div className="card-heading"><div><h2>Planilha de compromissos</h2><p>Use o cabeçalho do modelo para evitar erros.</p></div><FileSpreadsheet size={23}/></div>
 {canEdit?<><label className="upload-zone"><UploadCloud size={36} strokeWidth={1.4}/><strong>{file?file.name:'Selecione sua planilha'}</strong><span>Arquivo XLSX ou CSV, até 5 MB e 1.000 linhas por importação.</span><input type="file" accept=".xlsx,.csv" onChange={(e:ChangeEvent<HTMLInputElement>)=>{setFile(e.target.files?.[0]||null);setPreview(null);setResult(null)}}/></label><ErrorHint error={error}/><div className="button-row"><Button secondary disabled={!file||busy} onClick={()=>send(true)}>Verificar planilha</Button><Button disabled={!file||busy||!preview||preview.invalid>0||preview.truncated} onClick={()=>send(false)}>{busy?'Processando...':'Confirmar importação'}</Button></div><p className="hint">Primeiro valide a planilha. A importação só fica disponível quando não houver erros.</p></>:<p className="muted">Seu perfil permite consultar o histórico, sem importar dados.</p>}
 </Card>
 <Card><div className="card-heading"><div><h2>Conferência</h2><p>Prévia de validação dos dados.</p></div></div>
 {preview||result?<><div className="import-stats"><div><strong>{preview?preview.total:result.total}</strong><span>Registros</span></div><div><strong>{preview?preview.valid:result.imported}</strong><span>{preview?'Válidos':'Importados'}</span></div><div><strong>{preview?preview.invalid:result.rejected}</strong><span>Com erro</span></div></div>{(preview||result).errors?.length?<div className="import-errors">{(preview||result).errors.map((r:any,i:number)=><p key={i}><AlertCircle size={15}/> Linha {r.row}: {r.error}</p>)}</div>:<div className="success-line"><CheckCircle2 size={18}/> Nenhum erro encontrado</div>}{result?.skipped>0&&<div className="notice compact">{result.skipped} eventos duplicados foram ignorados.</div>}{(preview||result).truncated&&<div className="inline-error">Arquivo excede 1.000 linhas. Divida em lotes menores.</div>}</>:<Empty title="Pronto para validar" subtitle="Depois de selecionar um arquivo, você verá os registros válidos e os erros antes de importar."/>}
 </Card></div>
 <Card><div className="card-heading"><h2>Histórico de importações</h2></div>{history.data.items.length?<div className="data-list">{history.data.items.map((x:any)=><div className="data-row static-row" key={x.id}><FileSpreadsheet size={19}/><span className="row-main"><strong>{x.file_name}</strong><small>{fmtDate(x.created_at,true)}</small></span><span className="text-small">{x.imported} importados · {x.rejected} rejeitados</span></div>)}</div>:<Empty title="Nenhuma importação" subtitle="Os arquivos processados aparecerão neste histórico."/>}<Pagination page={history.page} pages={history.data.pages} onChange={history.setPage}/></Card></>;
}
