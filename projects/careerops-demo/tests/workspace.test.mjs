import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { addDays, seoulDate } from '../packages/domain/workflow.mjs';
import { csv, ics, markdown } from '../apps/web/exports.mjs';

const root=mkdtempSync(join(tmpdir(),'careerops-workspace-'));
const key='demo.development.'+randomBytes(32).toString('base64url');
let db,server,base,company,job;
const api=async(path,method='GET',body,version)=>{
  const headers={authorization:'Bearer '+key};
  if(body!==undefined) headers['content-type']='application/json';
  if(version!==undefined) headers['if-match']='"'+version+'"';
  const response=await fetch(base+'/api/v1/'+path,{headers,method,body:body===undefined?undefined:JSON.stringify(body)});
  return {code:response.status,data:await response.json()};
};
const call=async(path,method='GET',body,version,expected=200)=>{
  const response=await api(path,method,body,version);
  assert.equal(response.code,expected,JSON.stringify(response.data));
  return response.data;
};
const create=(path,body)=>call(path,'POST',body,undefined,201);
const schedule=(fields)=>create('schedules',{posting_id:job.id,kind:'interview',title:'Synthetic interview',...fields});
before(async()=>{
  db=openStore(root,'demo','development');
  server=await startServer(db,{realm:'demo',stage:'development',ownerKey:key,port:0});
  base='http://127.0.0.1:'+server.address().port;
  company=await create('companies',{name:'Synthetic engineering',aliases:['SE'],size_class:'B'});
  job=await create('job_postings',{company_id:company.id,round_key:'2026-review',role_code:'SIM',title:'Simulation engineer'});
});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  db?.close();
  rmSync(root,{recursive:true,force:true});
});

test('Phase 2 assets serve with a CSP and workspace requires authentication',async()=>{
  const html=await fetch(base+'/');
  assert.equal(html.status,200);
  assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await html.text(),/\/assets\/app\.mjs/);
  for(const file of ['app.mjs','dom.mjs','forms.mjs','workflow.mjs','contracts.mjs','exports.mjs','styles.css']) {
    const asset=await fetch(base+'/assets/'+file);
    assert.equal(asset.status,200);
    assert.ok((await asset.text()).length>100);
  }
  assert.equal((await fetch(base+'/api/v1/workspace')).status,401);
  assert.equal((await fetch(base+'/packages/database/migrations/001_foundation.sql')).status,401);
});
test('Phase 2 details, metadata replace, rollback on duplicates and live search data',async()=>{
  const fields={location:'Seoul',responsibilities:'Synthetic modeling',review_status:'reviewed',posting_status:'open',
    deadline_date:addDays(seoulDate(),2),requirements:[{kind:'required',criterion:'Engineering'}],
    sources:[{url:'https://example.invalid/role',verified_on:'2026-11-25',evidence:'Synthetic source'}]};
  job=await call('job_postings/'+job.id,'PATCH',fields,1);
  const details=await call('job_details/'+job.id);
  assert.deepEqual(details.requirements,fields.requirements);
  assert.deepEqual(details.sources,fields.sources);
  assert.equal((await api('job_postings/'+job.id,'PATCH',{sources:[...fields.sources,...fields.sources]},2)).code,409);
  assert.equal((await call('job_postings/'+job.id)).version,2);
  const view=await call('workspace');
  assert.equal(view.aliases[0].alias,'SE');
  assert.equal(view.metrics.approaching,1);
  assert.equal(view.metrics.verified,'2026-11-25');
});
test('Phase 2 explicit submission, excluded future schedule, past history, and new round',async()=>{
  const past=await schedule({start_date:addDays(seoulDate(),-2)});
  const future=await schedule({start_date:addDays(seoulDate(),2),status:'conditional',predecessor_id:past.id});
  const unknown=await schedule({});
  let row=await create('applications',{posting_id:job.id,intent:'planned'});
  assert.equal(row.stage,'not_submitted');
  assert.equal(row.submitted_at,null);
  const getBuckets=async()=>Object.fromEntries((await call('workspace')).schedules.map(item=>[item.id,item.bucket]));
  assert.deepEqual(await getBuckets(),{[unknown.id]:'undated',[past.id]:'history',[future.id]:'active'});
  assert.equal((await api('applications/'+row.id,'PATCH',{stage:'interview_planned'},1)).code,409);
  assert.equal((await api('applications/'+row.id,'PATCH',{stage:'submitted'},1)).code,409);
  row=await call('applications/'+row.id,'PATCH',{stage:'submitted',confirm_submission:true},1);
  assert.ok(row.submitted_at);
  row=await call('applications/'+row.id,'PATCH',{stage:'rejected'},2);
  assert.equal((await api('applications/'+row.id,'PATCH',{stage:'interview_planned'},3)).code,409);
  assert.deepEqual(await getBuckets(),{[unknown.id]:'excluded',[past.id]:'history',[future.id]:'excluded'});
  const prior=await call('schedules/'+future.id);
  assert.equal(prior.status,'conditional');
  const next=await create('job_postings',{company_id:company.id,round_key:'next',role_code:'SIM',title:'New round',previous_id:job.id});
  const nextDate=await create('schedules',{posting_id:next.id,title:'New interview',kind:'interview',start_date:addDays(seoulDate(),3)});
  assert.equal((await getBuckets())[nextDate.id],'active');
  assert.equal(db.prepare('SELECT count(*) n FROM application_events WHERE application_id=?').get(row.id).n,3);
});
test('Phase 2 detects conflicts for overlapping timed events and refuses schedule cycles',async()=>{
  const other=await create('job_postings',{company_id:company.id,round_key:'overlap',role_code:'SIM',title:'Overlap trial'});
  const day=addDays(seoulDate(),4);
  const event=fields=>create('schedules',{posting_id:other.id,kind:'test',title:'Overlap test',start_date:day,...fields});
  const a=await event({start_time:'13:00',end_time:'13:40'});
  const b=await event({start_time:'13:30',end_time:'14:00',predecessor_id:a.id});
  const c=await event({start_time:'14:00',end_time:'15:00'});
  assert.equal((await api('schedules/'+a.id,'PATCH',{predecessor_id:b.id},1)).code,409);
  assert.equal((await api('schedules/'+a.id,'DELETE',undefined,1)).code,409);
  const conflicts=(await call('workspace')).schedules.filter(row=>row.conflict).map(row=>row.id).sort();
  assert.deepEqual(conflicts,[a.id,b.id].sort());
  assert.ok(!conflicts.includes(c.id));
});
test('Phase 2 migration preserves existing dates, versions and integrity',()=>{
  const dir=join(root,'personal','development');
  // A v1 file is seeded via the isolated shell SQL, before the current migration runner reopens it.
  const created=openStore(root,'personal','development');
  created.close();
  const legacyRoot=mkdtempSync(join(root,'legacy-'));
  const legacyPath=join(legacyRoot,'personal','development');
  // mkdir is done synchronously by opening a temporary empty store at a distinct root.
  const legacy=new DatabaseSync(join(dir,'legacy.sqlite'));
  const src=readFileSync(new URL('../packages/database/migrations/001_foundation.sql',import.meta.url),'utf8');
  try {
    legacy.exec(src);
    legacy.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL); INSERT INTO instance_binding VALUES (1,'personal','development')");
    legacy.prepare('INSERT INTO schema_migrations VALUES (?,?)').run('001_foundation.sql',createHash('sha256').update(src.replace(/\r\n/g,'\n')).digest('hex'));
    legacy.exec("INSERT INTO companies(id,name) VALUES ('c','Fixture'); INSERT INTO job_postings(id,company_id,round_key,role_code,title) VALUES ('p','c','r','s','Role'); INSERT INTO schedules(id,posting_id,kind,title,start_date,end_date,version) VALUES ('e','p','test','Period','2026-12-01','2026-12-03',4)");
  } finally { legacy.close(); }
  // Copy the fixture into the expected per-instance path and run the real upgrade.
  mkdirSync(legacyPath,{recursive:true});
  copyFileSync(join(dir,'legacy.sqlite'),join(legacyPath,'careerops.sqlite'));
  const upgraded=openStore(legacyRoot,'personal','development');
  try {
    const row=upgraded.prepare("SELECT * FROM schedules WHERE id='e'").get();
    assert.equal(row.version,4);
    assert.equal(row.end_date,'2026-12-03');
    assert.equal(row.start_time,null);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { upgraded.close(); }
});
test('Phase 2 calendar exports preserve unknown dates and explicit KST times',()=>{
  const text=ics([
    {id:'untimed',title:'가상의 긴 행사 이름'.repeat(12),start_date:'2026-12-02',end_date:'2026-12-04',status:'conditional'},
    {id:'timed',title:'Timed event',start_date:'2026-12-05',start_time:'08:30',end_time:'09:00',certainty:'confirmed'},
    {id:'unknown',title:'Pending date'}
  ],new Date('2026-11-25T00:00:00Z'));
  assert.match(text,/DTSTART;VALUE=DATE:20261202\r\nDTEND;VALUE=DATE:20261205/);
  assert.match(text,/DTSTART:20261204T233000Z\r\nDTEND:20261205T000000Z/);
  assert.match(text,/STATUS:TENTATIVE/);
  assert.doesNotMatch(text,/Pending date/);
  assert.ok(text.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
  assert.match(csv(['Name'],[['=1+1']]),/"'=1\+1"/);
  assert.match(markdown(['Name'],[['A|B']]),/A\\\|B/);
});
test('Phase 2 dry runs roll back writes and undo adds a versioned compensating edit',async()=>{
  const row=await create('companies',{name:'Synthetic undo company',size_class:'D'});
  const after=await call('companies/'+row.id,'PATCH',{size_class:'C'},1);
  const beforeLogCount=db.prepare('SELECT count(*) n FROM change_logs').get().n;
  const preview=await call('batch_preview','POST',{items:[
    {type:'companies',id:row.id,version:after.version,patch:{size_class:'B'}},
    {type:'companies',id:row.id,version:after.version,patch:{size_class:'A'}},
    {type:'companies',id:'missing',version:1,patch:{size_class:'A'}}
  ]});
  assert.deepEqual(preview.map(item=>item.ok),[true,false,false]);
  assert.equal((await call('companies/'+row.id)).size_class,'C');
  assert.equal(db.prepare('SELECT count(*) n FROM change_logs').get().n,beforeLogCount);
  const log=db.prepare('SELECT seq FROM change_logs WHERE record_id=? ORDER BY seq DESC LIMIT 1').get(row.id);
  const restored=await call('undo/'+log.seq,'POST');
  assert.equal(restored.size_class,'D');
  assert.equal(restored.version,3);
  assert.equal((await api('undo/'+log.seq,'POST')).code,409);
});
