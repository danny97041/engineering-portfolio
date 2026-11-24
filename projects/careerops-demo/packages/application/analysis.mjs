import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { check, object, string, fieldsFor, resources } from '../domain/contracts.mjs';
import { assessRules, evaluateFit, identifyPosting, initialWeights, normalizeSource, normalizeText, ruleKeys, ruleVersion, weightsOf } from '../domain/analysis.mjs';
import { seoulDate } from '../domain/workflow.mjs';
import { transaction } from '../database/local.mjs';

const iso = ()=>new Date().toISOString();
const stable = value=>JSON.stringify(value,(_,item)=>item && typeof item==='object' && !Array.isArray(item) ?
  Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,'en'))) : item);
const hash = value=>createHash('sha256').update(stable(value)).digest('hex');
const fromJson = (row,fallback={})=>row ? JSON.parse(row) : fallback;
function parseUrl(value) {
  try { return normalizeSource(string(value,2048)); }
  catch { check(false,'Expected a valid source URL'); }
}
function storeMetric(db,metric,value,unit='count') {
  db.prepare('INSERT INTO usage_metrics VALUES (?,?,?,?,?)').run(randomUUID(),metric,value,unit,iso());
}
function settings(db) {
  const row=db.prepare("SELECT value_json,version FROM app_settings WHERE key='analysis.weights'").get();
  return {weights:fromJson(row?.value_json,initialWeights),version:row?.version ?? 0,ruleVersion};
}
export function updateWeights(service,actor,body) {
  service.authorize(actor,true);
  const {version,weights}=object(body);
  const next=weightsOf(weights);
  return transaction(service.db,()=>{
    const before=settings(service.db);
    check(version===before.version,'Weights changed',409);
    if (stable(before.weights)===stable(next)) return before;
    service.db.prepare("INSERT INTO app_settings(key,value_json,version) VALUES ('analysis.weights',?,1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,version=app_settings.version+1").run(JSON.stringify(next));
    const after=settings(service.db);
    service.audit(actor,'analysis_weights','analysis.weights',before,after);
    return after;
  });
}

function evidence(value) { return string(value,500); }
function validateFactInput(input) {
  const data=object(input);
  check(Object.keys(data).every(key=>['company','role','coding','qualifications','compensation'].includes(key)),'Unknown fact group');
  const facts={};
  if (data.company) {
    const {listed,employees,organization,evidence:source}=object(data.company);
    check(listed===undefined || typeof listed==='boolean','Listed must be boolean');
    check(employees===undefined || (Number.isSafeInteger(employees) && employees>=0),'Invalid employee count');
    check(organization===undefined || ['company','research','public'].includes(organization),'Unknown organization');
    facts.company={listed,employees,organization,evidence:evidence(source)};
  }
  if (data.role) {
    const {track,direct,fit,evidence:source}=object(data.role);
    check(track===undefined || ['industrial_cfd','physics_ai','manufacturing_simulation','other'].includes(track),'Unknown role track');
    check(direct===undefined || typeof direct==='boolean','Direct responsibility must be boolean');
    check(fit===undefined || typeof fit==='boolean','Role fit must be boolean');
    facts.role={track,direct,fit,evidence:evidence(source)};
  }
  if (data.coding) {
    const {type,evidence:source}=object(data.coding);
    check(['algorithm','other','none','unknown'].includes(type),'Unknown technical screening type');
    facts.coding={type,evidence:evidence(source)};
  }
  if (data.qualifications) {
    const entries=Object.entries(object(data.qualifications));
    facts.qualifications=Object.fromEntries(entries.map(([key,input])=>{
      check(ruleKeys.slice(0,5).includes(key),'Unknown qualification');
      const {mode,value,evidence:source}=object(input);
      check(['required','preferred','none','unknown'].includes(mode),'Unknown requirement mode');
      let accepted;
      if (mode==='required') {
        if (key==='experience') { check(Number.isFinite(value) && value>=0,'Invalid years'); accepted=value; }
        if (key==='degree') { check(['high_school','associate','bachelor','master','doctorate'].includes(value),'Invalid degree level'); accepted=value; }
        if (key==='major') { check(Array.isArray(value) && value.length>0 && value.length<=20,'Expected accepted majors'); accepted=value.map(item=>string(item)); }
        if (['license','language'].includes(key)) accepted=string(value);
      }
      return [key,{mode,value:accepted,evidence:evidence(source)}];
    }));
  }
  if (data.compensation) {
    const {base,variable,year,currency,evidence:source}=object(data.compensation);
    for (const amount of [base,variable]) check(amount===undefined || Number.isSafeInteger(amount) && amount>=0,'Invalid compensation amount');
    check(year===undefined || Number.isInteger(year) && year>=1900 && year<=2200,'Invalid compensation year');
    check(currency===undefined || /^[A-Z]{3}$/.test(currency),'Invalid currency');
    facts.compensation={base,variable,year,currency,evidence:evidence(source)};
  }
  return facts;
}
function factsFor(db,id) {
  const row=db.prepare('SELECT details,version,posting_version FROM analysis_facts WHERE posting_id=?').get(id);
  return {details:fromJson(row?.details),version:row?.version ?? 0,postingVersion:row?.posting_version ?? null};
}
function recentAssessment(db,id,afterVersion) {
  const row=db.prepare('SELECT id,assessed_at,evaluation_version,evidence,origin FROM assessments WHERE posting_id=? ORDER BY rowid DESC LIMIT 1').get(id);
  if (!row) return null;
  if (row.origin==='legacy') {
    const components=db.prepare('SELECT criterion,score,rationale AS evidence FROM assessment_scores WHERE assessment_id=?').all(row.id);
    return {origin:'legacy',components,assessedAt:row.assessed_at,evaluationVersion:row.evaluation_version,score:null,stale:true};
  }
  const last=fromJson(row.evidence);
  return {...last,stale:last.postingVersion!==afterVersion.postingVersion || last.factVersion!==afterVersion.factVersion ||
    last.weightVersion!==afterVersion.weightVersion || last.profileVersion!==afterVersion.profileVersion || last.ruleVersion!==ruleVersion,
    origin:row.origin,assessedAt:row.assessed_at,evaluationVersion:row.evaluation_version};
}
function contextFor(service,actor,id) {
  const db=service.db;
  const posting=service.read(actor,'job_postings',id);
  const app=db.prepare("SELECT * FROM applications WHERE posting_id=? AND user_id='owner' AND deleted_at IS NULL").get(id);
  const exclusion=db.prepare('SELECT id,reason FROM exclusions WHERE company_id=? OR posting_id=? ORDER BY company_id IS NULL,id LIMIT 1').get(posting.company_id,id);
  const profile=service.profile(actor);
  const facts=factsFor(db,id);
  const config=settings(db);
  const revisions={postingVersion:posting.version,factVersion:facts.version,weightVersion:config.version,profileVersion:profile.version};
  const clock=new Date();
  const seoulTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(clock);
  const factsStale=Boolean(facts.version && facts.postingVersion!==posting.version);
  return {posting,application:app,exclusion,profile:profile.details,facts:factsStale?{}:facts.details,
    inputFacts:facts.details,factsStale,today:seoulDate(clock),seoulTime,config,revisions};
}

function evaluateReview(service,actor,id,explicit) {
  const db=service.db;
  const started=performance.now();
  const context=contextFor(service,actor,id);
  const {posting,application,exclusion,inputFacts,factsStale,today,seoulTime,config,revisions}=context;
  // Time only affects the result at the next deadline boundary.
  const deadlinePassed=posting.deadline_date===today && Boolean(posting.deadline_time && posting.deadline_time<=seoulTime);
  const fingerprint=hash({id,revisions,application:application?.version,exclusion:exclusion?.id,today,deadlinePassed,ruleVersion});
  const cache=db.prepare('SELECT input_hash,value_json FROM analysis_cache WHERE posting_id=?').get(id);
  const material=cache?.input_hash===fingerprint ? fromJson(cache.value_json) : assessRules(context);
  if (explicit) {
    if (cache?.input_hash!==fingerprint) {
      db.prepare('INSERT INTO analysis_cache VALUES (?,?,?) ON CONFLICT(posting_id) DO UPDATE SET input_hash=excluded.input_hash,value_json=excluded.value_json')
        .run(id,fingerprint,JSON.stringify(material));
      storeMetric(db,'rules_local_evaluations',1);
    } else storeMetric(db,'rules_cache_hits',1);
    storeMetric(db,'rule_review_latency',performance.now()-started,'ms');
  }
  return {...material,versions:revisions,ruleVersion,companyExcluded:Boolean(exclusion),facts:inputFacts,factsStale,config,
    assessment:recentAssessment(db,id,revisions)};
}
export function reviewPosting(service,actor,id) {
  service.authorize(actor,true);
  return transaction(service.db,()=>evaluateReview(service,actor,id,true));
}

function stats(db, reviews, postings, apps) {
  const frequency = values=>Object.fromEntries([...values.reduce((map,value)=>{
    const key=value || 'unknown';
    return map.set(key,(map.get(key) ?? 0)+1);
  },new Map()).entries()].sort(([a],[b])=>a.localeCompare(b)));
  const first=db.prepare('SELECT min(occurred_at) AS time FROM application_events').get().time;
  const qualifications=db.prepare("SELECT criterion FROM job_requirements r JOIN job_postings j ON r.posting_id=j.id WHERE r.kind='required' AND j.deleted_at IS NULL").all();
  const days=db.prepare(`SELECT julianday(min(e.occurred_at))-julianday(a.submitted_at) AS duration
    FROM application_events e JOIN applications a ON e.application_id=a.id
    WHERE a.deleted_at IS NULL AND a.submitted_at IS NOT NULL AND e.next_stage IN ('rejected','hired','closed','offered')
    GROUP BY a.id HAVING duration>=0`).all();
  const submitted=apps.filter(row=>Boolean(row.submitted_at));
  const offered=apps.filter(row=>['offered','hired'].includes(row.stage) && row.submitted_at);
  const reviewed=Object.values(reviews);
  const scored=reviewed.filter(row=>row.score!==null && !row.stale);
  const observed=db.prepare(`SELECT metric,unit,count(*) AS samples,sum(value) AS total,avg(value) AS mean
    FROM usage_metrics GROUP BY metric,unit ORDER BY metric`).all();
  return {
    period:{first,through:iso()},denominators:{postings:postings.length,applications:apps.length,submitted:submitted.length,scored:scored.length},
    regions:frequency(postings.map(row=>row.location)),roles:frequency(postings.map(row=>row.role_code)),sizes:frequency(reviewed.map(row=>row.size)),
    stages:frequency(apps.map(row=>row.stage)),monthlySubmissions:frequency(submitted.map(row=>seoulDate(new Date(row.submitted_at)).slice(0,7))),
    eligibility:frequency(reviewed.map(row=>row.eligibility)),scores:frequency(scored.map(row=>row.score>=80?'80–100':row.score>=60?'60–79.99':'0–59.99')),
    offerShare:submitted.length?offered.length/submitted.length:null,averageTerminalDays:days.length?days.reduce((sum,row)=>sum+row.duration,0)/days.length:null,terminalSamples:days.length,
    scanOutcomes:db.prepare('SELECT outcome,count(*) AS count FROM scan_results GROUP BY outcome ORDER BY outcome').all(),
    intakeOutcomes:db.prepare("SELECT status,count(*) AS count FROM sync_batches WHERE idempotency_key LIKE 'intake:%' GROUP BY status ORDER BY status").all(),
    scanTrend:db.prepare('SELECT substr(started_at,1,10) AS utc_date,count(*) AS count FROM scan_runs GROUP BY utc_date ORDER BY utc_date DESC LIMIT 30').all(),
    requirements:frequency(qualifications.map(row=>normalizeText(row.criterion))),observed
  };
}
export function analysisIndex(service,actor) {
  service.authorize(actor,true);
  const db=service.db;
  const postings=service.read(actor,'job_postings');
  const apps=db.prepare("SELECT * FROM applications WHERE user_id='owner' AND deleted_at IS NULL").all();
  const result={};
  const candidateByCompany=new Set();
  const operationalPostingOrder=[...postings].sort((a,b)=>
    (a.deadline_date ?? '9999').localeCompare(b.deadline_date ?? '9999') || a.id.localeCompare(b.id));
  for (const posting of operationalPostingOrder) {
    const row=evaluateReview(service,actor,posting.id,false);
    const representative=row.recommendation==='candidate' && !candidateByCompany.has(posting.company_id);
    if (representative) candidateByCompany.add(posting.company_id);
    result[posting.id]={eligibility:row.eligibility,recommendation:row.recommendation,representative,excluded:row.companyExcluded,
      size:row.size,sizeLabel:row.sizeLabel,userGrade:row.userGrade,score:row.assessment?.score ?? null,
      stale:Boolean(row.assessment?.stale),components:row.assessment?.components ?? []};
  }
  return {postings:result,config:settings(db),stats:stats(db,result,postings,apps)};
}

export function updateFacts(service,actor,id,body) {
  service.authorize(actor,true);
  const {version,postingVersion,facts:raw}=object(body);
  const facts=validateFactInput(raw);
  const db=service.db;
  return transaction(db,()=>{
    const posting=service.read(actor,'job_postings',id);
    check(postingVersion===posting.version,'Posting changed',409);
    const before=factsFor(db,id);
    check(version===before.version,'Facts changed',409);
    if (stable(before.details)!==stable(facts) || (before.version && before.postingVersion!==posting.version)) {
      db.prepare(`INSERT INTO analysis_facts VALUES (?,?,1,?) ON CONFLICT(posting_id) DO UPDATE
        SET details=excluded.details,version=analysis_facts.version+1,posting_version=excluded.posting_version`)
        .run(id,stable(facts),posting.version);
      service.audit(actor,'analysis_facts',id,{version:before.version},{version:before.version+1,groups:Object.keys(facts)});
    }
    return evaluateReview(service,actor,id,false);
  });
}

export function recordAssessment(service,actor,id,body) {
  service.authorize(actor,true);
  const {versions,components}=object(body);
  const db=service.db;
  return transaction(db,()=>{
    const review=evaluateReview(service,actor,id,false);
    check(stable(versions)===stable(review.versions),'Analysis inputs changed',409);
    const result=evaluateFit(components,review.config.weights);
    const payload={...result,...review.versions,ruleVersion};
    const digest=hash(payload);
    const existing=db.prepare('SELECT id FROM assessments WHERE posting_id=? AND input_hash=?').get(id,digest);
    if (existing) {
      storeMetric(db,'assessment_cache_hits',1);
      return {id:existing.id,reused:true,...payload};
    }
    const key=randomUUID();
    db.prepare('INSERT INTO assessments(id,posting_id,evaluation_version,evidence,assessed_at,input_hash,origin) VALUES (?,?,?,?,?,?,?)')
      .run(key,id,'fit-v1',JSON.stringify(payload),iso(),digest,'manual');
    const add=db.prepare('INSERT INTO assessment_scores VALUES (?,?,?,?)');
    for(const part of result.components) if (part.score!==null) add.run(key,part.criterion,part.score,part.evidence);
    storeMetric(db,'assessment_local_calculations',1);
    service.audit(actor,'assessment',key,null,{posting_id:id,coverage:result.coverage,score:result.score});
    return {id:key,reused:false,...payload};
  });
}

export function setExclusion(service,actor,body) {
  service.authorize(actor,true);
  const {scope,id,reason,active}=object(body);
  check(['company','posting'].includes(scope) && typeof active==='boolean','Invalid exclusion target');
  const db=service.db;
  return transaction(db,()=>{
    service.read(actor,scope==='company'?'companies':'job_postings',string(id));
    const col=scope==='company'?'company_id':'posting_id';
    const stored=db.prepare('SELECT id FROM exclusions WHERE '+col+'=? ORDER BY id').all(id);
    if (active && stored.length) return {active:true,scope,id};
    if (active) db.prepare('INSERT INTO exclusions(id,'+col+',reason) VALUES (?,?,?)').run(randomUUID(),id,string(reason));
    else if (stored.length) db.prepare('DELETE FROM exclusions WHERE '+col+'=?').run(id);
    if (active || stored.length) service.audit(actor,'exclusion',id,{scope,active:stored.length>0},{scope,active});
    return {active,scope,id};
  });
}

function mergeSources(before,after) {
  const byUrl=new Map(before.map(row=>[parseUrl(row.url),row]));
  for (const row of after) {
    const old=byUrl.get(row.url);
    if (!old || !old.verified_on || (row.verified_on && row.verified_on>=old.verified_on)) {
      byUrl.set(row.url,{url:row.url,verified_on:row.verified_on ?? old?.verified_on ?? null,evidence:row.evidence ?? old?.evidence ?? null});
    }
  }
  return [...byUrl.values()].sort((a,b)=>a.url.localeCompare(b.url,'en'));
}
export function ingestPosting(service,actor,body) {
  service.authorize(actor,true);
  const {key,company,posting:raw,content}=object(body);
  const requestKey=string(key,128);
  const companyName=string(company,200);
  const input=object(raw);
  check(!Object.hasOwn(input,'company_id') && !Object.hasOwn(input,'content_hash') && !Object.hasOwn(input,'previous_id'),'Intake requires a company name and independent posting details');
  const normalized=fieldsFor(resources.job_postings,{...input,company_id:'pending'},false);
  if (content!==undefined) normalized.content_hash=hash(normalizeText(string(content,10000)));
  normalized.sources=mergeSources([], (normalized.sources ?? []).map(row=>({...row,url:parseUrl(row.url)})));
  const digest=hash({company:normalizeText(companyName),posting:normalized});
  const db=service.db;
  return transaction(db,()=>{
    const prior=db.prepare('SELECT payload_digest,result_json FROM sync_batches WHERE idempotency_key=?').get('intake:'+requestKey);
    if (prior) {
      check(prior.payload_digest===digest && prior.result_json,'Intake key already used for a different request',409);
      storeMetric(db,'intake_replays',1);
      return {...fromJson(prior.result_json),replayed:true};
    }
    const batch=randomUUID();
    db.prepare("INSERT INTO sync_batches(id,idempotency_key,payload_digest,status) VALUES (?,?,?,'pending')").run(batch,'intake:'+requestKey,digest);
    const matches=db.prepare(`SELECT c.id,c.name,a.alias FROM companies c LEFT JOIN company_aliases a ON a.company_id=c.id
      WHERE c.deleted_at IS NULL ORDER BY c.id`).all()
      .filter(row=>[row.name,row.alias].some(value=>normalizeText(value)===normalizeText(companyName)));
    const ids=[...new Set(matches.map(row=>row.id))];
    let decision;
    if (ids.length!==1) {
      decision={decision:'review',ids,reason:'company_unresolved'};
    } else {
      normalized.company_id=ids[0];
      const rows=db.prepare('SELECT * FROM job_postings WHERE company_id=? AND deleted_at IS NULL').all(ids[0]).map(row=>({
        ...row,urls:service.relations('job_postings',row.id).sources.map(item=>item.url)
      }));
      decision=identifyPosting(normalized,rows,normalized.sources.map(row=>row.url));
      if (decision.decision==='create') {
        const created=service.mutate(actor,'job_postings',undefined,undefined,normalized,batch);
        decision.id=created.id;
      }
      if (decision.decision==='merge') {
        const id=decision.id;
        const previous=service.read(actor,'job_postings',id);
        const relations=service.relations('job_postings',id);
        const patch={...normalized,sources:mergeSources(relations.sources,normalized.sources)};
        // Keep identity and any user-owned or reviewed fields out of scan updates.
        for (const key of ['company_id','round_key','role_code','review_status','requirements']) delete patch[key];
        const comparable={...previous,...relations,sources:mergeSources([],relations.sources.map(row=>({...row,url:parseUrl(row.url)})))};
        const changes=Object.fromEntries(Object.entries(patch).filter(([key,value])=>stable(value)!==stable(comparable[key])));
        if (Object.keys(changes).length) service.mutate(actor,'job_postings',id,previous.version,changes,batch);
        decision.changed=Object.keys(changes);
        storeMetric(db,'intake_duplicate_merges',1);
      }
    }
    const result={...decision,batch};
    if (result.decision==='review') db.prepare('INSERT INTO intake_reviews VALUES (?,?,?,?)')
      .run(randomUUID(),batch,JSON.stringify({company:companyName,posting:normalized,...decision}),iso());
    db.prepare('UPDATE sync_batches SET status=?,result_json=? WHERE id=?').run(result.decision,JSON.stringify(result),batch);
    service.audit(actor,'intake',batch,null,{decision:result.decision,posting_id:result.id ?? null},batch);
    storeMetric(db,'intake_payload_bytes',Buffer.byteLength(JSON.stringify(body)),'bytes');
    return {...result,replayed:false};
  });
}
export function intakeQueue(service,actor) {
  service.authorize(actor,true);
  return service.db.prepare('SELECT id,batch_id,evidence_json,created_at FROM intake_reviews ORDER BY created_at DESC LIMIT 100').all()
    .map(row=>({id:row.id,batch:row.batch_id,createdAt:row.created_at,...JSON.parse(row.evidence_json)}));
}
