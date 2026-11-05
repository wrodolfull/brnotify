import {useEffect,useState} from 'react';
import {Clock3,Info,Save,RefreshCw} from 'lucide-react';
import {useApp} from '../context';
import {Button,Card,ErrorHint,Loader,PageTitle} from '../components';
type Rule={slot:number;enabled:boolean;offset_value:number;offset_unit:'days'|'weeks'|'months';send_time:string;template_id:string|null};
export function Automations(){
 const {api,role,notify}=useApp(),[rules,setRules]=useState<Rule[]>([]),[templates,setTemplates]=useState<any[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{Promise.all([api('/api/reminder-rules'),api('/api/templates')]).then(([r,t])=>{setRules(r);setTemplates(t.items||[])}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[api]);
 const update=(slot:number,key:keyof Rule,value:any)=>setRules(rows=>rows.map(r=>r.slot===slot?{...r,[key]:value}:r));
 const save=async()=>{setBusy(true);setError('');try{await api('/api/reminder-rules',{method:'PUT',body:JSON.stringify(rules.map(r=>({...r,send_time:r.send_time.slice(0,5)})))});notify('Regras salvas. Reprogramação iniciada.')}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 if(loading)return <Loader/>;
 return <><PageTitle eyebrow="AUTOMAÇÃO" title="Regras de lembretes" subtitle="Configure até três momentos de contato, com horários e mensagens independentes." action={role==='admin'?<Button disabled={busy} onClick={save}><Save size={17}/> {busy?'Salvando...':'Salvar regras'}</Button>:null}/>
 <div className="notice"><Info size={18}/><span>Essas regras são o padrão do ambiente. Cada evento pode ter configurações individuais. Alterações acionam a reprogramação dos eventos futuros.</span></div>
 <ErrorHint error={error}/>
 <div className="rule-grid">{rules.map((rule,i)=><Card className={'rule-card '+(!rule.enabled?'rule-disabled':'')} key={rule.slot}><div className="rule-header"><div className="rule-number">0{rule.slot}</div><label className="toggle"><input type="checkbox" checked={rule.enabled} disabled={role==='viewer'} onChange={e=>update(rule.slot,'enabled',e.target.checked)}/><span/></label></div><h2>{rule.slot===1?'Primeiro lembrete':rule.slot===2?'Segundo lembrete':'Último lembrete'}</h2><p className="muted">Antecedência em relação à data do evento.</p>
 <div className="form-grid"><label className="field"><span>Antecedência</span><input type="number" min={1} max={365} disabled={!rule.enabled||role==='viewer'} value={rule.offset_value} onChange={e=>update(rule.slot,'offset_value',Number(e.target.value))}/></label><label className="field"><span>Unidade</span><select disabled={!rule.enabled||role==='viewer'} value={rule.offset_unit} onChange={e=>update(rule.slot,'offset_unit',e.target.value)}><option value="days">Dias antes</option><option value="weeks">Semanas antes</option><option value="months">Meses antes</option></select></label></div>
 <label className="field"><span>Horário do disparo</span><input type="time" disabled={!rule.enabled||role==='viewer'} value={rule.send_time.slice(0,5)} onChange={e=>update(rule.slot,'send_time',e.target.value)}/></label>
 <label className="field"><span>Template aprovado na GoTo</span><select value={rule.template_id||''} disabled={!rule.enabled||role==='viewer'} onChange={e=>update(rule.slot,'template_id',e.target.value||null)}><option value="">Selecione um template</option>{templates.filter(t=>t.status==='APPROVED').map(t=><option key={t.id} value={t.id}>{t.name} ({t.language_code})</option>)}</select></label>
 </Card>)}</div><div className="bottom-hint"><Clock3 size={19}/><span>O sistema usa o fuso horário definido no ambiente e não envia lembretes cuja data programada já tenha passado.</span></div></>;
}
