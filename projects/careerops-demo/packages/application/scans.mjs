import { createHash, randomUUID } from 'node:crypto';
import { check, ApiError } from '../domain/contracts.mjs';
import { ingestPosting } from './analysis.mjs';
import { transaction } from '../database/local.mjs';

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));
  return value;
}
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
export function preview(service,action) {
  const db=service.db;
  db.exec('SAVEPOINT inspect_changes');
  try {return action();} finally {db.exec('ROLLBACK TO inspect_changes; RELEASE inspect_changes');}
}
function processItem(service,actor,run,item,index) {
  const {company,posting,source,observedAt,evidence,expectedVersion}=item;
  check(/^https?:\/\//i.test(source) && URL.canParse(source),'Expected source URL');
  const instant=new Date(observedAt);
  check(!Number.isNaN(+instant) && instant.toISOString()===observedAt && +instant<=Date.now(),'Expected past or current UTC timestamp');
  const allowed=['round_key','role_code','title','location','posting_number','open_date','deadline_date','deadline_time','posting_status','responsibilities','employment_type','headcount','compensation'];
  check(Object.keys(posting).every(k=>allowed.includes(k)),'Scan field is outside discovery scope');
  const input={key:'scan-'+run+'-'+index,company,posting:{...posting,sources:[{url:source,verified_on:observedAt.slice(0,10),evidence}]}};
  const apply=()=>ingestPosting(service,actor,input,run);
  const trial=preview(service,apply);
  const db=service.db;
  let outcome, previous=null, after=null, id=trial.decision==='merge'?trial.id:null;
  if (id) previous=service.read(actor,'job_postings',id);
  const watermark=id && db.prepare('SELECT observed_at FROM scan_watermarks WHERE posting_id=?').get(id);
  const differs=trial.changed?.length>0;
  const stale=watermark && (watermark.observed_at>observedAt || (differs && watermark.observed_at===observedAt));
  const manual=id && differs && db.prepare("SELECT max(changed_at) AS at FROM change_logs WHERE entity='job_postings' AND record_id=? AND NOT EXISTS(SELECT 1 FROM sync_batches WHERE id=change_logs.correlation_id)").get(id).at;
  const excluded=id && db.prepare('SELECT 1 FROM exclusions WHERE posting_id=? OR company_id=?').get(id,previous.company_id);
  if (excluded) outcome='excluded';
  else if (stale || (manual && manual>observedAt) || (differs && expectedVersion!==previous.version) || (expectedVersion!==undefined && !previous)) outcome='conflict';
  else {
    const actual=apply();
    id=actual.id ?? null;
    outcome=actual.decision==='create'?'new':actual.decision==='review'?'review':differs?'changed':'duplicate';
    if (id) {
      after=service.read(actor,'job_postings',id);
      db.prepare('INSERT OR REPLACE INTO scan_watermarks VALUES (?,?)').run(id,observedAt);
      if (db.prepare('SELECT 1 FROM exclusions WHERE posting_id=? OR company_id=?').get(id,after.company_id)) outcome='excluded';
    }
  }
  const fields=Object.keys(posting);
  const snapshot=row=>row && Object.fromEntries(fields.map(k=>[k,row[k]??null]));
  db.prepare('INSERT INTO scan_results VALUES (?,?,?,?,?)').run(randomUUID(),run,id,outcome,JSON.stringify({
    company,round:posting.round_key,source,observedAt,evidence,previous:snapshot(previous),proposed:posting,after:snapshot(after),
    scheduleProposal:item.scheduleProposal??null
  }));
  return outcome;
}
export function recordScan(service,actor,{key,items,origin='unverified'}) {
  service.authorize(actor,true);
  check(['unverified','manual','scheduled'].includes(origin),'Unknown scan source');
  const db=service.db, digest=fingerprint(items);
  return transaction(db,()=>{
    const old=db.prepare('SELECT * FROM scan_runs WHERE idempotency_key=?').get(key);
    if (old) {
      check(old.digest===digest && old.origin===origin,'Run key reused for another batch',409);
      if (old.status==='succeeded' || old.attempts>=3) return runReceipt(db,old.id);
    }
    const id=old?.id ?? randomUUID(), now=new Date().toISOString();
    if (old) db.prepare("UPDATE scan_runs SET attempts=attempts+1,status='running',started_at=?,ended_at=NULL,last_error=NULL WHERE id=?").run(now,id);
    else db.prepare("INSERT INTO scan_runs(id,idempotency_key,digest,started_at,status,request_json,origin) VALUES (?,?,?,?,'running',?,?)").run(id,key,digest,now,JSON.stringify(items),origin);
    db.exec('SAVEPOINT scan_batch');
    let status='succeeded',error=null;
    try {items.forEach((item,index)=>processItem(service,actor,id,item,index));}
    catch(err) {
      db.exec('ROLLBACK TO scan_batch');
      status='failed'; error=err instanceof ApiError?err.message:'Temporary storage failure';
    } finally {db.exec('RELEASE scan_batch');}
    const ended=new Date().toISOString();
    db.prepare('UPDATE scan_runs SET status=?,ended_at=?,last_error=? WHERE id=?').run(status,ended,error,id);
    db.prepare('INSERT INTO scan_attempts SELECT id,attempts,ended_at,status,last_error FROM scan_runs WHERE id=?').run(id);
    return runReceipt(db,id);
  });
}
function runReceipt(db,id) {
  const run=db.prepare('SELECT id,started_at,ended_at,status,attempts,last_error,origin FROM scan_runs WHERE id=?').get(id);
  const counts=db.prepare('SELECT outcome,count(*) AS total FROM scan_results WHERE run_id=? GROUP BY outcome').all(id);
  return {...run,counts:Object.fromEntries(counts.map(r=>[r.outcome,r.total])),durationMs:Date.parse(run.ended_at)-Date.parse(run.started_at),retryable:run.status==='failed' && run.attempts<3};
}
export function scanHistory(service,{offset=0,limit=15,id}) {
  const db=service.db;
  if (id) {
    check(db.prepare('SELECT 1 FROM scan_runs WHERE id=?').get(id),'Run not found',404);
    return {...runReceipt(db,id),items:db.prepare('SELECT posting_id,outcome,evidence FROM scan_results WHERE run_id=? ORDER BY rowid LIMIT ? OFFSET ?').all(id,limit,offset)
      .map(r=>({...r,evidence:JSON.parse(r.evidence??'null')}))};
  }
  const rows=db.prepare('SELECT id FROM scan_runs ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?').all(limit,offset);
  const last=status=>db.prepare('SELECT max(ended_at) AS time FROM (SELECT ended_at,status FROM scan_attempts UNION ALL SELECT ended_at,status FROM scan_runs) WHERE status=?').get(status).time;
  return {items:rows.map(r=>runReceipt(db,r.id)),lastSuccess:last('succeeded'),lastFailure:last('failed'),nextScheduledAt:null};
}
