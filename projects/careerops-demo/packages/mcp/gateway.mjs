import { randomUUID } from 'node:crypto';
import { definition, paramsSchema, validate } from './protocol.mjs';
import { ApiError, check, resources } from '../domain/contracts.mjs';
import { ruleKeys, ruleVersion } from '../domain/analysis.mjs';
import { transaction } from '../database/local.mjs';
import { applications, changeApplication, workspace } from '../application/workspace.mjs';
import { analysisIndex, ingestPosting, recordAssessment, reviewPosting } from '../application/analysis.mjs';
import { fingerprint, preview, recordScan, scanHistory } from '../application/scans.mjs';
import { records } from '../application/records.mjs';
import { importBatch } from '../application/exchange.mjs';

const id={type:'string',minLength:1,maxLength:128}, text={type:'string',minLength:1,maxLength:500};
const version={type:'integer',minimum:1}, limit={type:'integer',minimum:1,maximum:30};
const page={offset:{type:'integer',minimum:0},limit}, anyObject={type:'object'};
const rows=(items,{offset=0,limit=15})=>({items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null});
const sourceFields=paramsSchema({url:{type:'string',minLength:1,maxLength:2048},verified_on:text,evidence:text},['url']);
const requirement=paramsSchema({kind:{type:'string',enum:['required','preferred']},criterion:text},['kind','criterion']);
const specialFields={headcount:{type:'integer',minimum:0},sources:{type:'array',items:sourceFields,maxItems:50},
  requirements:{type:'array',items:requirement,maxItems:50},source_url:{type:'string',minLength:1,maxLength:2048}};
function entity(type,create=false,keys=Object.keys(resources[type].fields)) {
  const required=resources[type].required;
  const properties=Object.fromEntries(keys.map(key=>{
    const field=specialFields[key]??text;
    const nullable=!required.includes(key) && !['status','certainty','review_status','posting_status','requirements','sources'].includes(key);
    return [key,nullable?{anyOf:[field,{type:'null'}]}:field];
  }));
  return paramsSchema(properties,create?required.filter(k=>keys.includes(k)):[]);
}
const application=paramsSchema({posting_id:id,intent:text,stage:text,confirm_submission:{type:'boolean'}});
const scanPosting=entity('job_postings',true,['round_key','role_code','title','location','posting_number','open_date','deadline_date','deadline_time','posting_status','responsibilities','employment_type','headcount','compensation']);
const scanItem=paramsSchema({company:text,source:{type:'string',maxLength:2048},observedAt:text,evidence:text,expectedVersion:version,posting:scanPosting,
  scheduleProposal:paramsSchema({title:text,date:text,reason:text},['title','date','reason'])},['company','source','observedAt','evidence','posting']);
const batch={items:{type:'array',items:scanItem,minItems:1,maxItems:10}};
const tools=new Map();
function register(name,description,props,required,execute,{write=false,publicRead=false}={}) {
  const schema=paramsSchema(write?{...props,key:id}:props,write?[...required,'key']:required);
  tools.set(name,{meta:definition(name,description,schema,write),execute,write,publicRead});
}
const catalog={publicRead:true}, writing={write:true};
const readJob=(s,a,id)=>({...s.read(a,'job_postings',id),...s.relations('job_postings',id)});
register('search_jobs','Search posting titles, roles and rounds. Results are paginated.',{...page,query:text},[],(s,a,p)=>{
  const q=(p.query??'').toLocaleLowerCase();
  const offset=p.offset??0,limit=p.limit??15,items=[];
  let cursor='',skipped=0;
  const fetchPage=s.db.prepare('SELECT id,title,round_key,role_code FROM job_postings WHERE deleted_at IS NULL AND id>? ORDER BY id LIMIT 128');
  for(;;){
    const batch=fetchPage.all(cursor);
    for(const row of batch){
      if(![row.title,row.round_key,row.role_code].some(v=>v.toLocaleLowerCase().includes(q))) continue;
      if(skipped<offset){skipped++;continue;}
      if(items.length===limit) return {items,nextOffset:offset+limit};
      items.push(s.read(a,'job_postings',row.id));
    }
    if(batch.length<128) return {items,nextOffset:null};
    cursor=batch.at(-1).id;
  }
},catalog);
const exchange={schemaVersion:{type:'integer',const:1},items:{type:'array',minItems:1,maxItems:30,items:anyObject}};
register('preview_work_batch','Preview a versioned Work exchange batch and return row decisions.',{...exchange,key:id},['schemaVersion','items','key'],(s,a,p)=>importBatch(s,a,p,true));
register('apply_work_batch','Apply a reviewed Work batch and return the durable row receipts.',exchange,['schemaVersion','items'],(s,a,p)=>importBatch(s,a,p,false),writing);
register('confirm_official_deadline','Confirm one sourced deadline change on an exact posting and its linked deadline event.',{
  postingId:id,postingVersion:version,scheduleId:id,scheduleVersion:version,date:text,time:text,source:{type:'string',maxLength:2048},evidence:text,verifiedOn:text
},['postingId','postingVersion','scheduleId','scheduleVersion','date','source','evidence','verifiedOn'],(s,a,p)=>{
  const event=s.read(a,'schedules',p.scheduleId);
  check(event.posting_id===p.postingId && event.kind==='deadline','Not the linked deadline event',409);
  const sources=s.relations('job_postings',p.postingId).sources.filter(row=>row.url!==p.source)
    .map(row=>Object.fromEntries(Object.entries(row).filter(([,value])=>value!==null)));
  sources.push({url:p.source,verified_on:p.verifiedOn,evidence:p.evidence});
  const posting=s.mutate(a,'job_postings',p.postingId,p.postingVersion,{deadline_date:p.date,deadline_time:p.time??null,sources});
  const schedule=s.mutate(a,'schedules',p.scheduleId,p.scheduleVersion,{start_date:p.date,end_date:null,start_time:null,end_time:p.time??null,source_url:p.source,verified_on:p.verifiedOn,certainty:'confirmed'});
  return {postingId:posting.id,postingVersion:posting.version,scheduleId:schedule.id,scheduleVersion:schedule.version};
},writing);
register('get_job_details','Read a single posting by exact ID and its source evidence.',{id},['id'],(s,a,p)=>readJob(s,a,p.id),catalog);
register('get_dashboard','Return workspace counts and the reporting date.',{},[],(s,a)=>{const w=workspace(s,a);return {today:w.today,metrics:w.metrics};});
function schedulePage(items,{offset=0,limit=15}){
  const page=[];
  let size=0;
  for(const row of items.slice(offset,offset+limit)){
    const bytes=Buffer.byteLength(JSON.stringify(row))+1;
    if(page.length&&size+bytes>28000) break;
    page.push(row);size+=bytes;
  }
  const next=offset+page.length;
  return {items:page,nextOffset:next<items.length?next:null};
}
register('get_schedule','Read schedules with status and conflicts. Use bucket=active for the active schedule, and nextOffset for more rows.',
  {...page,bucket:{type:'string',enum:['active','undated','history','excluded']}},[],(s,a,p)=>
    schedulePage(workspace(s,a).schedules.filter(row=>!p.bucket||row.bucket===p.bucket),p));
register('get_upcoming_events','Read active dated schedules in chronological order.',page,[],(s,a,p)=>rows(workspace(s,a).schedules.filter(r=>r.bucket==='active'),p));
register('check_schedule_conflicts','List active schedule conflicts on the stored calendar.',page,[],(s,a,p)=>rows(workspace(s,a).schedules.filter(r=>r.conflict),p));
register('get_applications','Read a page of application decisions and submission stages.',page,[],(s,a,p)=>rows(applications(s,a),p));
register('get_user_profile','Read the current owner qualification profile.',{},[],(s,a)=>s.profile(a));
register('get_recruitment_rules','List the active built-in eligibility rule identifiers.',{},[],()=>({version:ruleVersion,rules:ruleKeys}));
register('get_unreviewed_jobs','List postings awaiting review.',page,[],(s,a,p)=>rows(s.read(a,'job_postings').filter(r=>['new','unreviewed','needs_verification'].includes(r.review_status)),p));
register('get_assessment','Read latest saved assessment for an exact posting.',{id},['id'],(s,a,p)=>({assessment:reviewPosting(s,a,p.id).assessment}));
register('list_assessments','Read a page of saved assessment metadata.',page,[],(s,a,p)=>({items:s.db.prepare('SELECT id,posting_id,evaluation_version,assessed_at FROM assessments ORDER BY assessed_at DESC,id LIMIT ? OFFSET ?').all(p.limit??15,p.offset??0)}));
register('evaluate_eligibility','Evaluate the current rules against stored posting evidence.',{id},['id'],(s,a,p)=>reviewPosting(s,a,p.id));
register('compare_jobs','Compare two to five distinct posting IDs and their evidence.',{ids:{type:'array',items:id,minItems:2,maxItems:5}},['ids'],(s,a,p)=>{
  check(new Set(p.ids).size===p.ids.length,'Expected distinct posting IDs');
  return {items:p.ids.map(id=>readJob(s,a,id))};
});
register('get_interview_context','Read one application and its interview preparations.',{id},['id'],(s,a,p)=>{
  const application=applications(s,a,p.id);
  return {application,preparations:s.db.prepare('SELECT id,notes,updated_at FROM interview_preparations WHERE application_id=? ORDER BY updated_at DESC LIMIT 10').all(p.id),
    records:records(s,a,{postingId:application.posting_id,limit:10})};
});
register('analytics','Compute descriptive workspace statistics.',{},[],(s,a)=>analysisIndex(s,a).stats);
function changes(s,a,{after=0,limit=15}) {
  const items=s.db.prepare('SELECT seq,entity,record_id,actor,correlation_id,changed_at FROM change_logs WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit);
  return {items,nextAfter:items.at(-1)?.seq??after};
}
for (const name of ['get_recent_changes','export_changes']) register(name,'Read change metadata after a sequence number.',{after:page.offset,limit},[],changes);
register('export_schedule','Export a page of active schedule rows as JSON. Use nextOffset for more rows.',page,[],(s,a,p)=>schedulePage(workspace(s,a).schedules.filter(r=>r.bucket==='active'),p));
register('export_handover','Export summary counts and one page of changes.',{after:page.offset,limit},[],(s,a,p)=>({metrics:workspace(s,a).metrics,changes:changes(s,a,p)}));
register('get_scan_runs','Read scan outcomes, failure queue and per-run evidence.',{...page,id},[],(s,a,p)=>scanHistory(s,p));
register('check_duplicate','Preview identity resolution for one incoming posting without saving.',{company:text,posting:entity('job_postings')},['company','posting'],(s,a,p)=>preview(s,()=>{
  const r=ingestPosting(s,a,{...p,key:randomUUID()});
  return {decision:r.decision,existingId:r.decision==='merge'?r.id:null,candidates:r.ids??[]};
}));
register('validate_import','Dry-run a scan batch and return its item outcomes.',batch,['items'],(s,a,p)=>preview(s,()=>{
  const receipt=recordScan(s,a,{...p,key:randomUUID()});
  return {status:receipt.status,counts:receipt.counts,error:receipt.last_error};
}));
for (const name of ['import_job_batch','record_scan_run']) register(name,'Receive a bounded discovery batch. Replay the same key and items for retry.',batch,['items'],recordScan,writing);
register('retry_scan_run','Retry one failed run using its stored payload, up to three total attempts.',{id},['id'],(s,a,p)=>{
  const row=s.db.prepare('SELECT status,idempotency_key,request_json FROM scan_runs WHERE id=?').get(p.id);
  check(row,'Run not found',404);
  check(row.status==='failed' && row.request_json,'Expected a failed reprocessable run',409);
  return recordScan(s,a,{key:row.idempotency_key,items:JSON.parse(row.request_json)});
},writing);
for (const [name,type,edit] of [['add_job','job_postings',false],['update_job','job_postings',true],['add_schedule','schedules',false],['update_schedule','schedules',true]]) {
  register(name,edit?'Edit one exact record at its observed version.':'Create one validated record.',edit?{id,version,data:entity(type)}:{data:entity(type,true)},edit?['id','version','data']:['data'],(s,a,p)=>s.mutate(a,type,p.id,p.version,p.data),writing);
}
for (const [name,edit] of [['add_application',false],['update_application_status',true]]) {
  register(name,'Save one explicit application decision. Submission requires confirmation.',edit?{id,version,data:application}:{data:application},edit?['id','version','data']:['data'],(s,a,p)=>changeApplication(s,a,p.id,p.version,p.data),writing);
}
register('save_assessment','Save an assessment at its observed input versions.',{id,data:paramsSchema({versions:anyObject,components:anyObject},['versions','components'])},['id','data'],(s,a,p)=>recordAssessment(s,a,p.id,p.data),writing);
register('save_interview_feedback','Append feedback to one existing interview question.',{id,feedback:text},['id','feedback'],(s,a,p)=>{
  check(s.db.prepare('SELECT id FROM interview_questions WHERE id=?').get(p.id),'Question not found',404);
  const receipt={id:randomUUID(),question_id:p.id};
  s.db.prepare('INSERT INTO interview_feedback VALUES (?,?,?,?)').run(receipt.id,p.id,p.feedback,new Date().toISOString());
  s.audit(a,'interview_feedback',receipt.id,null,receipt);
  return receipt;
},writing);
export const listTools=actor=>[...tools.values()].filter(t=>actor==='owner'||t.publicRead).map(t=>t.meta);
export function callTool(service,actor,name,args,callId=randomUUID()) {
  const db=service.db;
  let status=200,bytes=0;
  try {
    const tool=tools.get(name);
    check(tool,'Unknown tool',404);
    service.authorize(actor,!tool.publicRead);
    try {validate(args,tool.meta.inputSchema);} catch(e) {throw new ApiError(422,e.message);}
    return transaction(db,()=>{
      const write=tool.write && !['record_scan_run','import_job_batch'].includes(name);
      const digest=write && fingerprint(args);
      const old=write && db.prepare('SELECT digest,result FROM tool_receipts WHERE actor=? AND name=? AND request_key=?').get(actor,name,args.key);
      if (old) check(old.digest===digest,'Key reused with different arguments',409);
      const result=old?JSON.parse(old.result):tool.execute(service,actor,args);
      const encoded=JSON.stringify(result);
      bytes=Buffer.byteLength(encoded);
      check(bytes<=32768,'Result too large. Narrow the requested range.',413);
      if (write && !old) db.prepare('INSERT INTO tool_receipts VALUES (?,?,?,?,?)').run(actor,name,args.key,digest,encoded);
      return result;
    });
  } catch(error) {status=error.status??500;throw error;}
  finally {
    const event=[String(callId).slice(0,160),actor,name.slice(0,120),status,new Date().toISOString(),bytes];
    if(service.logToolCall) service.logToolCall(event);
    else db.prepare('INSERT INTO tool_calls(call_id,actor,tool,status,occurred_at,result_bytes) VALUES (?,?,?,?,?,?)').run(...event);
  }
}
