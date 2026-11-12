/** Read annotated download headers while keeping legacy CSV/XLSX formats valid. */
export function normalizeBatchHeader(header:string):string{
 return header.trim().replace(/\s*\((?:obrigat[oó]rio|opcional)\)\s*$/i,'').trim();
}

/** An unchanged demo phone or variable must never become a real GoTo dispatch. */
export function hasBatchExamplePlaceholders(phone:string,variables:Record<string,string>):boolean{
 return phone.replace(/\D/g,'')==='5511999999999'||
  Object.values(variables).some(value=>value.trim()==='SUBSTITUIR_EXEMPLO');
}
