import { check, object, string, ApiError } from '../domain/contracts.mjs';
import { transaction } from '../database/local.mjs';
import { fingerprint, preview } from './scans.mjs';
import { applications, changeApplication, workspace } from './workspace.mjs';
import { recordAssessment, setExclusion, updateFacts, reviewPosting } from './analysis.mjs';
import { writeRecord } from './records.mjs';

export const operations=['companies','job_postings','schedules','applications','profile','rules','exclusions','analysis_facts','assessments','career_records'];
function rule(service,actor,{code,version,definition,active}){
  code=string(code,80);
  object(definition);
  check(Number.isSafeInteger(version)&&version>=1&&typeof active==='boolean','Invalid rule version or active flag');
  const db=service.db;
  check(!db.prepare('SELECT 1 FROM rules WHERE code=? AND version=?').get(code,version),'Rule version already exists',409);
  const id=code+'/'+version;
  db.prepare('INSERT INTO rules VALUES (?,?,?,?,?)').run(id,code,version,JSON.stringify(definition),Number(active));
  service.audit(actor,'rules',id,null,{code,version,definition,active});
  return {id};
}
function perform(service,actor,{type,id,version,data}){
  switch(type){
    case 'companies':case 'job_postings':case 'schedules':
      if(!id && type==='companies') {
        const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
        const names=service.db.prepare('SELECT name AS value FROM companies WHERE deleted_at IS NULL UNION ALL SELECT a.alias FROM company_aliases a JOIN companies c ON c.id=a.company_id WHERE c.deleted_at IS NULL').all();
        check(!names.some(r=>normalize(r.value)===normalize(data.name)),'Company already exists or matches an alias',409);
      }
      return service.mutate(actor,type,id,version,data);
    case 'applications':return changeApplication(service,actor,id,version,data);
    case 'profile':return service.setProfile(actor,version,data);
    case 'rules':return rule(service,actor,data);
    case 'exclusions':return setExclusion(service,actor,data);
    case 'analysis_facts':return updateFacts(service,actor,id,{version,postingVersion:service.read(actor,'job_postings',id).version,facts:data});
    case 'assessments':return recordAssessment(service,actor,id,{versions:reviewPosting(service,actor,id).versions,components:data});
    case 'career_records':return writeRecord(service,actor,{...data,id,version});
    default:throw new ApiError(422,'Unknown import entity');
  }
}
function resolve(input,refs){
  if(Array.isArray(input)) return input.map(v=>resolve(v,refs));
  if(input && typeof input==='object'){
    const entries=Object.entries(input);
    if(entries.length===1 && entries[0][0]==='$ref'){
      const id=refs.get(input.$ref);
      check(id,'Unresolved prior row reference',409);
      return id;
    }
    return Object.fromEntries(entries.map(([k,v])=>[k,resolve(v,refs)]));
  }
  return input;
}
function rowsOf(service,actor,items){
  const refs=new Map(), seen=new Set(),db=service.db;
  return items.map((raw,index)=>{
    db.exec('SAVEPOINT exchange_row');
    try {
      object(raw);
      check(Object.keys(raw).every(k=>['ref','type','id','version','data'].includes(k)),'Unknown import row field');
      const ref=string(raw.ref,80);
      check(!seen.has(ref),'Duplicate import reference',409);
      seen.add(ref);
      object(raw.data);
      const input=resolve(raw,refs);
      const beforeSeq=db.prepare('SELECT coalesce(max(seq),0) AS seq FROM change_logs').get().seq;
      const result=perform(service,actor,input);
      const changes=db.prepare('SELECT seq,entity,record_id,before_json,after_json FROM change_logs WHERE seq>? ORDER BY seq').all(beforeSeq);
      if(result.id) refs.set(ref,result.id);
      return {index,ref,ok:true,id:result.id??input.id??null,version:result.version??null,changes};
    } catch(error){
      db.exec('ROLLBACK TO exchange_row');
      if(!(error instanceof ApiError)) throw error;
      return {index,ref:typeof raw?.ref==='string'?raw.ref:null,ok:false,status:error.status,error:error.message};
    } finally {db.exec('RELEASE exchange_row');}
  });
}
export function importBatch(service,actor,body,dryRun=false){
  service.authorize(actor,true);
  const {schemaVersion,key,items}=object(body);
  check(Object.keys(body).every(k=>['schemaVersion','key','items'].includes(k)),'Unknown import field');
  check(schemaVersion===1 && Array.isArray(items) && items.length>=1 && items.length<=30,'Expected schemaVersion 1 and 1–30 rows');
  const requestKey=string(key,128),receiptKey='import:'+requestKey,digest=fingerprint(items),db=service.db;
  return transaction(db,()=>{
    const old=db.prepare('SELECT digest,result FROM exchange_receipts WHERE key=?').get(receiptKey);
    if(old){check(old.digest===digest,'Import key reused with different data',409);return {...JSON.parse(old.result),replayed:true};}
    if(dryRun) return {dryRun:true,rows:preview(service,()=>rowsOf(service,actor,items))};
    const result={key:requestKey,rows:rowsOf(service,actor,items)};
    db.prepare('INSERT INTO exchange_receipts VALUES (?,?,?)').run(receiptKey,digest,JSON.stringify(result));
    return result;
  });
}
export function exportData(service,actor,mode,after=0){
  service.authorize(actor,true);
  const db=service.db;
  if(mode==='changes'){
    check(Number.isSafeInteger(after)&&after>=0,'Invalid change cursor');
    const items=db.prepare('SELECT * FROM change_logs WHERE seq>? ORDER BY seq LIMIT 100').all(after);
    return {schemaVersion:1,items,nextAfter:items.at(-1)?.seq??after};
  }
  if(mode==='handover'){
    const w=workspace(service,actor);
    return {schemaVersion:1,today:w.today,metrics:w.metrics,schedules:w.schedules.filter(r=>r.bucket==='active'),
      applications:applications(service,actor),unreviewed:w.postings.filter(r=>['new','unreviewed','needs_verification'].includes(r.review_status))};
  }
  check(mode==='full','Unknown export mode');
  const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables=Object.fromEntries(names.map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
  return {schemaVersion:1,binding:service.binding,tables};
}
