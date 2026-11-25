import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessRules, classifyCompany, criteria, evaluateFit, initialWeights, normalizeSource, weightsOf } from '../packages/domain/analysis.mjs';
import { openStore } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { addDays,seoulDate } from '../packages/domain/workflow.mjs';

const evidence='Synthetic official posting evidence';
const eligible=Object.fromEntries(['experience','degree','major','license','language'].map(key=>[key,{mode:'none',evidence}]));
const cutoff='2026-11-25';
const facts={company:{listed:false,employees:40,evidence},
  role:{track:'industrial_cfd',direct:true,evidence},coding:{type:'none',evidence},qualifications:eligible};
const input={posting:{deadline_date:cutoff,deadline_time:'15:00',round_key:'fixture'},facts,profile:{},today:cutoff,seoulTime:'14:59'};
const current={...input.posting,deadline_date:addDays(seoulDate(),10)};

test('Phase 3 classifies company boundaries with evidence and only proven JD responsibility adds the suffix',()=>{
  for (const [listed,employees,expected] of [[true,40,'B'],[true,200,'B'],[false,100,'B'],[false,99,'C'],[false,50,'C'],[false,49,'D'],[false,1,'D'],[false,0,null]]) {
    assert.equal(classifyCompany({listed,employees,evidence}),expected);
  }
  assert.equal(classifyCompany({listed:true,employees:90}),null);
  assert.equal(classifyCompany({organization:'research',evidence}),'research');
  assert.equal(assessRules(input).sizeLabel,'D-1');
  assert.equal(assessRules(input).recommendation,'candidate');
  assert.equal(assessRules({...input,facts:{...facts,role:{track:'industrial_cfd',direct:false,evidence}}}).recommendation,'review');
});
test('Phase 3 keeps required conditions, preferred conditions, unknown screening, and deadlines separate',()=>{
  const profile={languages:['OPIc IM2'],industry_years:0,degree:'master',major:'Physics',certifications:[]};
  const check=(mode)=>assessRules({...input,profile,facts:{...facts,qualifications:{...eligible,language:{mode,value:'OPIc IH',evidence}}}});
  assert.equal(check('required').eligibility,'FAIL');
  assert.equal(check('preferred').eligibility,'PASS');
  const unknownCoding=assessRules({...input,facts:{...facts,coding:{type:'unknown',evidence}}});
  assert.equal(unknownCoding.eligibility,'PASS');
  assert.equal(unknownCoding.recommendation,'review');
  const algorithm=assessRules({...input,facts:{...facts,coding:{type:'algorithm',evidence}}});
  assert.equal(algorithm.eligibility,'PASS');
  assert.deepEqual(algorithm.exclusionReasons,['algorithm_test_confirmed']);
  const closed=assessRules({...input,seoulTime:'15:00'});
  assert.equal(closed.eligibility,'PASS');
  assert.deepEqual(closed.exclusionReasons,['posting_closed']);
  const unknownClose=assessRules({...input,posting:{...input.posting,deadline_time:null}});
  assert.equal(unknownClose.eligibility,'PASS');
  assert.equal(unknownClose.recommendation,'review');
  const excluded=assessRules({...input,exclusion:{reason:'Synthetic exclusion'}});
  assert.equal(excluded.eligibility,'PASS');
  assert.deepEqual(excluded.exclusionReasons,['excluded_by_user']);
  assert.equal(assessRules({...input,application:{id:'a',intent:'planned',stage:'not_submitted'}}).userGrade,'A');
  const handled=assessRules({...input,application:{id:'a',intent:'planned',stage:'submitted'}});
  assert.equal(handled.eligibility,'PASS');
  assert.equal(handled.applicationStage,'submitted');
  assert.deepEqual(handled.exclusionReasons,['round_already_handled']);
  assert.equal(assessRules({...input,profile,facts:{...facts,qualifications:{...eligible,
    language:{mode:'required',value:'TOEIC 800',evidence}}}}).eligibility,'UNKNOWN');
});
test('Phase 3 complete weight coverage and unknown components have distinct score handling',()=>{
  const components=Object.fromEntries(criteria.map((key,index)=>[key,{score:[100,90,80,70,60,50][index],evidence}]));
  const fit=evaluateFit(components,initialWeights);
  assert.equal(fit.score,81);
  assert.equal(fit.coverage,100);
  delete components.conditions;
  const partial=evaluateFit(components,initialWeights);
  assert.equal(partial.coverage,90);
  assert.equal(partial.score,null);
  assert.equal(partial.components.at(-1).score,null);
  assert.throws(()=>weightsOf({...initialWeights,conditions:11}),{status:422});
  assert.throws(()=>evaluateFit({skills:{score:98,evidence:''}},initialWeights),{status:422});
  assert.equal(normalizeSource('https://EXAMPLE.invalid/jobs?a=1&utm_source=x#details'),'https://example.invalid/jobs?a=1');
});

const root=mkdtempSync(join(tmpdir(),'careerops-analysis-'));
const key='demo.development.'+randomBytes(32).toString('base64url');
const reader='demo.development.'+randomBytes(32).toString('base64url');
let db,server,base,company,job;
async function call(path,method='GET',body,code=200,version,token=key) {
  const headers={authorization:'Bearer '+token};
  if (body!==undefined) headers['content-type']='application/json';
  if (version!==undefined) headers['if-match']='"'+version+'"';
  const res=await fetch(base+'/api/v1/'+path,{headers,method,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();
  assert.equal(res.status,code,JSON.stringify(data));
  return data;
}
before(async()=>{
  db=openStore(root,'demo','development');
  server=await startServer(db,{realm:'demo',stage:'development',ownerKey:key,readerKey:reader,port:0});
  base='http://127.0.0.1:'+server.address().port;
  company=await call('companies','POST',{name:'Synthetic Thermal',aliases:['ST Lab']},201);
  job=await call('job_postings','POST',{company_id:company.id,round_key:'R1',role_code:'CFD',title:'Synthetic CFD',
    open_date:seoulDate(),deadline_date:current.deadline_date,sources:[{url:'https://example.invalid/official?id=88&utm_source=a'}]},201);
});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  db?.close();
  rmSync(root,{recursive:true,force:true});
});

test('Phase 3 intake merges trusted round identities, records changes, handles replay and queues uncertainty',async()=>{
  const payload={key:'same-round',company:'st lab',posting:{round_key:'r1',role_code:'cfd',title:job.title,
    open_date:seoulDate(),deadline_date:addDays(seoulDate(),11),sources:[{url:'https://example.invalid/official?utm_source=b&id=88'},
      {url:'https://example.invalid/mirror'}]}};
  const requests=await Promise.all([call('intake','POST',payload),call('intake','POST',payload)]);
  assert.deepEqual(requests.map(row=>row.replayed).sort(),[false,true]);
  assert.ok(requests.every(row=>row.id===job.id && row.decision==='merge'));
  assert.equal(new Set(requests.map(row=>row.batch)).size,1);
  assert.equal((await call('job_details/'+job.id)).sources.length,2);
  const saved=await call('job_postings/'+job.id);
  assert.equal(saved.deadline_date,payload.posting.deadline_date);
  assert.equal(saved.version,2);
  const logged=db.prepare("SELECT correlation_id FROM change_logs WHERE entity='job_postings' AND record_id=? ORDER BY seq DESC LIMIT 1").get(job.id);
  assert.equal(logged.correlation_id,requests[0].batch);
  await call('intake','POST',{...payload,posting:{...payload.posting,title:'Changed'}},409);
  const ambiguous=await call('intake','POST',{...payload,key:'possibly-new',posting:{...payload.posting,round_key:'R2'}});
  assert.equal(ambiguous.decision,'review');
  assert.deepEqual(ambiguous.ids,[job.id]);
  const created=await call('intake','POST',{...payload,key:'different-round',posting:{round_key:'R3',role_code:'CFD',title:job.title,
    open_date:addDays(seoulDate(),31),deadline_date:addDays(seoulDate(),40),sources:[{url:'https://example.invalid/future'}]}});
  assert.equal(created.decision,'create');
  assert.notEqual(created.id,job.id);
  assert.equal((await call('intake')).length,1);
  assert.deepEqual((await call('analysis')).stats.intakeOutcomes,[
    {status:'create',count:1},{status:'merge',count:1},{status:'review',count:1}
  ]);
});
test('Phase 3 review cache, profile, hard cuts, score de-duplication and version invalidation',async()=>{
  await call('analysis','GET',undefined,403,undefined,reader);
  await call('profile','PUT',{degree:'master',industry_years:0,languages:['OPIc IM2'],certifications:[]},200,1);
  const structured={...facts,qualifications:{...eligible,language:{mode:'required',value:'OPIc IH',evidence}}};
  const postingVersion=(await call('job_postings/'+job.id)).version;
  await call('analysis_facts/'+job.id,'PUT',{version:0,postingVersion,facts:structured});
  await call('analysis_facts/'+job.id,'PUT',{version:0,postingVersion,facts:structured},409);
  const result=await call('analysis/'+job.id);
  const repeated=await call('analysis/'+job.id);
  assert.deepEqual(result,repeated);
  assert.equal(result.eligibility,'FAIL');
  assert.equal(result.rules.find(row=>row.id==='language').evidence,evidence);
  const scores={versions:result.versions,components:Object.fromEntries(criteria.map(key=>[key,{score:99,evidence}]))};
  const assessment=await call('assessments/'+job.id,'POST',scores);
  assert.equal(assessment.score,99);
  assert.deepEqual(await call('assessments/'+job.id,'POST',scores),{...assessment,reused:true});
  assert.equal((await call('analysis')).postings[job.id].eligibility,'FAIL');
  assert.equal((await call('analysis')).postings[job.id].score,99);
  const weights={...initialWeights,direct_fit:29,conditions:11};
  await call('analysis_weights','PUT',{weights,version:0});
  await call('assessments/'+job.id,'POST',scores,409);
  const revised=await call('analysis/'+job.id);
  assert.equal(revised.assessment.stale,true);
  const observed=(await call('analysis')).stats.observed;
  assert.equal(observed.find(row=>row.metric==='assessment_cache_hits').total,1);
  assert.ok(observed.find(row=>row.metric==='rules_cache_hits').total>=1);
  assert.ok(observed.find(row=>row.metric==='intake_payload_bytes').total>0);
  const live=await call('job_postings/'+job.id);
  await call('job_postings/'+job.id,'PATCH',{responsibilities:'Revised synthetic duties'},200,live.version);
  const stale=await call('analysis/'+job.id);
  assert.equal(stale.factsStale,true);
  assert.equal(stale.rules.find(row=>row.id==='language').status,'UNKNOWN');
  await call('analysis_facts/'+job.id,'PUT',{version:stale.versions.factVersion,postingVersion,facts:structured},409);
  const confirmed=await call('analysis_facts/'+job.id,'PUT',{
    version:stale.versions.factVersion,postingVersion:stale.versions.postingVersion,facts:structured
  });
  assert.equal(confirmed.factsStale,false);
  assert.equal(confirmed.rules.find(row=>row.id==='language').status,'FAIL');
});
test('Phase 3 exclusions affect active schedule, recommendations and stats without deleting history',async()=>{
  const event=await call('schedules','POST',{title:'Synthetic interview',kind:'interview',posting_id:job.id,start_date:addDays(seoulDate(),3)},201);
  await call('exclusions','PUT',{scope:'company',id:company.id,reason:'Synthetic policy',active:true});
  const work=await call('workspace');
  assert.equal(work.schedules.find(row=>row.id===event.id).bucket,'excluded');
  assert.equal(work.schedules.find(row=>row.id===event.id).excluded,true);
  assert.ok(!work.focus.deadlines.includes(job.id));
  assert.equal((await call('analysis/'+job.id)).rules.find(row=>row.id==='exclusion').status,'FAIL');
  assert.ok((await call('analysis')).stats.eligibility.FAIL>=1);
  await call('exclusions','PUT',{scope:'company',id:company.id,active:false});
  assert.equal((await call('workspace')).schedules.find(row=>row.id===event.id).bucket,'active');
  assert.ok(work.activity.find(row=>row.entity==='profiles').after_json.includes('redacted'));
});
