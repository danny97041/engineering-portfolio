import { check, object, resources, string, versionNumber } from '../domain/contracts.mjs';
import { normalizeSource } from '../domain/analysis.mjs';
import { seoulDate } from '../domain/workflow.mjs';
import { transaction } from '../database/transaction.mjs';
import { fingerprint } from './scans.mjs';

export const fitDimensions=['overall_fit','masters_research_fit','ai_project_fit','career_value_3to5_years','long_term_retention_value'];

function shape(row,postingVersion) {
  return row&&{...JSON.parse(row.details),version:row.version,postingVersion:row.posting_version,
    stale:row.posting_version!==postingVersion,recordedAt:row.recorded_at};
}
export function fitProfile(service,actor,id,postingVersion) {
  service.authorize(actor,true);
  const version=postingVersion??service.read(actor,'job_postings',id).version;
  return shape(service.db.prepare('SELECT * FROM fit_profiles WHERE posting_id=? ORDER BY version DESC LIMIT 1').get(id),version)??null;
}
function scoreEntry(input) {
  if(input===null||input===undefined) return null;
  const {min,max,status,source,evidence}=object(input);
  check(Object.keys(input).every(k=>['min','max','status','source','evidence'].includes(k)),'Unknown score field');
  check(Number.isFinite(min)&&Number.isFinite(max)&&min>=0&&max<=100&&min<=max,'Invalid 0–100 score range');
  check(['provisional','confirmed'].includes(status),'Invalid score status');
  const url=string(source,2048);
  check(URL.canParse(url),'Expected source URL');
  return {min,max,status,source:normalizeSource(url),evidence:string(evidence,500)};
}
export function saveFitProfile(service,actor,id,body) {
  service.authorize(actor,true);
  const {key,version,postingVersion,asOf,reason,scores}=object(body);
  check(Object.keys(body).every(k=>['key','version','postingVersion','asOf','reason','scores'].includes(k)),'Unknown fit evaluation field');
  const receiptKey=string(key,128);
  check(Number.isSafeInteger(version)&&version>=0,'Invalid evaluation version');
  versionNumber(postingVersion);
  const date=resources.schedules.fields.start_date(asOf);
  check(date<=seoulDate(),'Evaluation date is in the future');
  const note=string(reason,500);
  object(scores);
  check(Object.keys(scores).every(k=>fitDimensions.includes(k)),'Unknown fit dimension');
  const entries=Object.fromEntries(fitDimensions.map(k=>[k,scoreEntry(scores[k])]));
  const details={asOf:date,reason:note,scores:entries,method:'independent-v1'};
  const digest=fingerprint({id,version,postingVersion,details});
  const db=service.db;
  return transaction(db,()=>{
    const posting=service.read(actor,'job_postings',id);
    const prior=db.prepare('SELECT * FROM fit_profiles WHERE receipt_key=?').get(receiptKey);
    if(prior){
      check(prior.digest===digest,'Fit key reused with different content',409);
      return shape(prior,posting.version);
    }
    const current=fitProfile(service,actor,id,posting.version);
    check(posting.version===postingVersion&&(current?.version??0)===version,'Posting or evaluation changed',409);
    const recordedAt=new Date().toISOString();
    db.prepare('INSERT INTO fit_profiles VALUES(?,?,?,?,?,?,?)').run(id,version+1,postingVersion,receiptKey,digest,recordedAt,JSON.stringify(details));
    service.audit(actor,'fit_profiles',id,current?{version:current.version}:null,{version:version+1,postingVersion});
    return {...details,version:version+1,postingVersion,stale:false,recordedAt};
  });
}
