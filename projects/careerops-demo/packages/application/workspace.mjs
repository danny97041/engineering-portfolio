import { randomUUID } from 'node:crypto';
import { ApiError, check, fieldsFor, object, resources, string, versionNumber } from '../domain/contracts.mjs';
import { addDays, applicationChange, applicationInactive, overlappingSchedules, scheduleState, seoulDate } from '../domain/workflow.mjs';
import { transaction } from '../database/local.mjs';

export function applications(service,actor,id) {
  service.authorize(actor,true);
  const rows = service.db.prepare("SELECT * FROM applications WHERE user_id='owner' AND deleted_at IS NULL ORDER BY id").all();
  if (id === undefined) return rows;
  const row = rows.find(record=>record.id === id);
  check(row,'Application not found',404);
  return row;
}

export function changeApplication(service,actor,id,version,input) {
  service.authorize(actor,true);
  const creating = id === undefined;
  const data = object(input);
  const keys = creating ? ['posting_id','intent','stage','confirm_submission'] : ['intent','stage','confirm_submission'];
  check(Object.keys(data).length && Object.keys(data).every(key=>keys.includes(key)),'Invalid application fields');
  for (const key of ['intent','stage']) {
    if (Object.hasOwn(data,key)) string(data[key]);
  }
  if (!creating) versionNumber(version);
  const db = service.db;
  return transaction(db,()=>{
    const before = creating ? null : applications(service,actor,id);
    if (before) check(before.version===version,'Record changed',409);
    const posting = service.read(actor,'job_postings',creating ? string(data.posting_id) : before.posting_id);
    const next = applicationChange(before,data);
    if (before && before.intent===next.intent && before.stage===next.stage) return before;
    if (creating) {
      check(!db.prepare("SELECT 1 FROM applications WHERE user_id='owner' AND posting_id=?").get(posting.id),'Application already exists',409);
      id = randomUUID();
      db.prepare("INSERT INTO applications (id,posting_id,user_id,intent,stage,submitted_at) VALUES (?,?,'owner',?,?,?)")
        .run(id,posting.id,next.intent,next.stage,next.submitted_at);
    } else {
      db.prepare('UPDATE applications SET intent=?,stage=?,submitted_at=?,version=version+1 WHERE id=?')
        .run(next.intent,next.stage,next.submitted_at,id);
    }
    db.prepare('INSERT INTO application_events (id,application_id,previous_stage,next_stage,occurred_at,source,previous_intent,next_intent) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(),id,before?.stage ?? null,next.stage,new Date().toISOString(),'manual',before?.intent ?? null,next.intent);
    const after = applications(service,actor,id);
    service.audit(actor,'applications',id,before,after);
    return after;
  });
}

export function undoEdit(service,actor,sequence) {
  service.authorize(actor,true);
  const db=service.db;
  return transaction(db,()=>{
    const log=db.prepare('SELECT * FROM change_logs WHERE seq=?').get(Number(sequence));
    check(log?.before_json && Object.hasOwn(resources,log.entity),'This change cannot be undone',409);
    const after=JSON.parse(log.after_json);
    check(!after.deleted_at,'Restore deleted records through recovery',409);
    const before=JSON.parse(log.before_json);
    const patch=Object.fromEntries(Object.keys(resources[log.entity].fields)
      .filter(key=>Object.hasOwn(before,key) && JSON.stringify(before[key])!==JSON.stringify(after[key]))
      .map(key=>[key,before[key]]));
    check(Object.keys(patch).length,'No editable fields changed',409);
    return service.mutate(actor,log.entity,log.record_id,after.version,patch);
  });
}

export function previewEdits(service,actor,body) {
  service.authorize(actor,true);
  const {items}=object(body);
  check(Array.isArray(items) && items.length>0 && items.length<=30,'Expected 1 to 30 edits');
  const db=service.db;
  return transaction(db,()=>{
    const seen=new Set();
    return items.map((input,index)=>{
      db.exec('SAVEPOINT preview_edit');
      try {
        const {type,id,version,patch}=object(input);
        check(typeof type==='string' && typeof id==='string' && Object.hasOwn(resources,type),'Invalid resource or ID');
        const key=type+'/'+id;
        check(!seen.has(key),'Duplicate target in batch',409);
        seen.add(key);
        fieldsFor(resources[type],patch,true);
        service.mutate(actor,type,id,version,patch);
        return {index,id,ok:true};
      } catch(error) {
        if (!(error instanceof ApiError)) throw error;
        return {index,ok:false,error:error.message};
      } finally {
        db.exec('ROLLBACK TO preview_edit; RELEASE preview_edit');
      }
    });
  });
}

export function workspace(service,actor) {
  service.authorize(actor,true);
  const db = service.db;
  const today = seoulDate();
  const companies = service.read(actor,'companies');
  const postings = service.read(actor,'job_postings');
  const apps = applications(service,actor);
  const byPosting = new Map(apps.map(row=>[row.posting_id,row]));
  const exclusions = db.prepare('SELECT company_id,posting_id FROM exclusions').all();
  const blockedCompanies = new Set(exclusions.map(row=>row.company_id).filter(Boolean));
  const blockedPostings = new Set(exclusions.map(row=>row.posting_id).filter(Boolean));
  const blocked = new Set(postings.filter(row=>blockedCompanies.has(row.company_id) || blockedPostings.has(row.id)).map(row=>row.id));
  const rows = service.read(actor,'schedules');
  const schedules = rows.map(item=>{
    const bucket=scheduleState(item,today,byPosting.get(item.posting_id));
    const excluded=blocked.has(item.posting_id);
    return {...item,excluded,bucket:excluded && bucket!=='history'?'excluded':bucket};
  });
  const conflicts = overlappingSchedules(schedules);
  const active = schedules.filter(item=>item.bucket==='active');
  const upcoming = addDays(today,7);
  const near = postings.filter(row=>row.deadline_date >= today && row.deadline_date <= upcoming && !applicationInactive(byPosting.get(row.id)) && !blocked.has(row.id));
  const waiting = apps.filter(row=>['screening_pending','final_pending'].includes(row.stage) && !applicationInactive(row) && !blocked.has(row.posting_id));
  const reviews = postings.filter(row=>['new','unreviewed','needs_verification'].includes(row.review_status));
  const missingVerification = postings.filter(row=>!blocked.has(row.id) && !db.prepare('SELECT 1 FROM job_sources WHERE posting_id=? AND verified_on IS NOT NULL LIMIT 1').get(row.id));
  return {
    today,companies,postings,applications:apps,
    schedules:schedules.map(row=>({...row,conflict:conflicts.has(row.id)})),
    aliases:db.prepare('SELECT alias,company_id FROM company_aliases ORDER BY alias').all(),
    metrics:{
      candidates:postings.length, planned:apps.filter(row=>['planned','secondary'].includes(row.intent) && row.stage==='not_submitted').length,
      inProgress:apps.filter(row=>row.stage !=='not_submitted' && !applicationInactive(row)).length,
      waiting:waiting.length, interviews:active.filter(row=>row.kind==='interview').length, unreviewed:reviews.length,
      approaching:near.length, scans:db.prepare('SELECT max(ended_at) AS time FROM scan_runs').get().time,
      verified:db.prepare('SELECT max(verified_on) AS date FROM job_sources').get().date
    },
    focus:{deadlines:near.map(row=>row.id),waiting:waiting.map(row=>row.posting_id),verification:missingVerification.map(row=>row.id)},
    activity:db.prepare(`SELECT seq,entity,record_id,actor,correlation_id,changed_at,
      CASE WHEN entity='profiles' THEN '{"redacted":true}' ELSE before_json END AS before_json,
      CASE WHEN entity='profiles' THEN '{"redacted":true}' ELSE after_json END AS after_json
      FROM change_logs ORDER BY seq DESC LIMIT 24`).all()
  };
}
