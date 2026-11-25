import { randomUUID } from 'node:crypto';
import { check, object, resources, string, versionNumber } from '../domain/contracts.mjs';
import { transaction } from '../database/local.mjs';

const fields={
  interview:['title','venue','format','expectedQuestions','concepts','draftAnswers','actualQuestions','actualAnswers','feedback','weaknesses','improvements','chatUrl','studyIds','completed'],
  document:['title','category','revision','submittedOn','referenceUrl','notes'],
  study:['title','topic','notes','referenceUrl','completed']
};
const unpack=({details,...row})=>({...row,data:JSON.parse(details)});
export function records(service,actor,{id,postingId,limit=30,offset=0}={}) {
  service.authorize(actor,true);
  const db=service.db;
  if (id) {
    const row=db.prepare('SELECT * FROM career_records WHERE id=? AND deleted_at IS NULL').get(id);
    check(row,'Record not found',404);
    return unpack(row);
  }
  check(Number.isInteger(limit) && limit>=1 && limit<=50 && Number.isSafeInteger(offset) && offset>=0,'Invalid records page');
  const rows=db.prepare('SELECT * FROM career_records WHERE deleted_at IS NULL AND (? IS NULL OR posting_id=?) ORDER BY updated_at DESC,id LIMIT ? OFFSET ?')
    .all(postingId??null,postingId??null,limit+1,offset);
  return {items:rows.slice(0,limit).map(unpack),nextOffset:rows.length>limit?offset+limit:null};
}

function validateDetails(service,actor,kind,data) {
  object(data);
  check(Object.hasOwn(fields,kind) && Object.keys(data).every(k=>fields[kind].includes(k)),'Invalid record fields');
  const result={title:string(data.title,200)};
  for(const [key,value] of Object.entries(data)) {
    if(key==='title') continue;
    if(key==='completed') {
      check(typeof value==='boolean','Invalid study completion status');
      result[key]=value;
    } else if(key==='studyIds') {
      check(Array.isArray(value) && value.length<=20 && new Set(value).size===value.length,'Invalid study references');
      result[key]=value.map(id=>{
        id=string(id,128);
        check(records(service,actor,{id}).kind==='study','Expected a study record');
        return id;
      });
    } else if(key==='revision') {
      result[key]=versionNumber(value);
    } else if(key==='submittedOn') {
      result[key]=resources.schedules.fields.start_date(value);
    } else {
      result[key]=string(value,4000);
      if(key.endsWith('Url')) check(URL.canParse(result[key]) && new URL(result[key]).protocol==='https:','Expected HTTPS link');
    }
  }
  if(kind==='document'){
    check(['resume','cover_letter','research_plan','portfolio','competency','submission_evidence'].includes(result.category),'Invalid document category');
    versionNumber(result.revision);
  }
  return result;
}

export function writeRecord(service,actor,{id,version,kind,postingId,data,remove=false}){
  service.authorize(actor,true);
  const db=service.db;
  return transaction(db,()=>{
    const now=new Date().toISOString();
    const before=id?records(service,actor,{id}):null;
    if(before){
      check(versionNumber(version)===before.version,'Record changed',409);
      check(kind===undefined && postingId===undefined,'Record type and posting are fixed');
      kind=before.kind;postingId=before.posting_id;
    }
    if(remove){
      check(before,'Record required',404);
      if(kind==='study') check(!db.prepare(`SELECT 1 FROM career_records,json_each(details,'$.studyIds')
        WHERE deleted_at IS NULL AND json_each.value=? LIMIT 1`).get(id),'Study record is referenced',409);
      db.prepare('UPDATE career_records SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?').run(now,now,id);
    } else {
      check(kind!=='interview'||postingId,'Interview requires a posting');
      if(postingId) service.read(actor,'job_postings',postingId);
      const details=JSON.stringify(validateDetails(service,actor,kind,data));
      if(before) db.prepare('UPDATE career_records SET details=?,updated_at=?,version=version+1 WHERE id=?').run(details,now,id);
      else {
        id=randomUUID();
        db.prepare('INSERT INTO career_records(id,kind,posting_id,details,updated_at) VALUES (?,?,?,?,?)').run(id,kind,postingId??null,details,now);
      }
    }
    const after=unpack(db.prepare('SELECT * FROM career_records WHERE id=?').get(id));
    service.audit(actor,'career_records',id,before,after);
    return after;
  });
}
