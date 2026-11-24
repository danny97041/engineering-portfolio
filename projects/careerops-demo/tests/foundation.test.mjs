import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { seed } from '../fixtures/synthetic/seed.mjs';
import { d1Catalog } from '../integrations/sites/catalog.mjs';

const instances = [];
let root, personal, demo, reader;
const credential = (realm,stage='development') => [realm,stage,randomBytes(32).toString('base64url')].join('.');
async function instance(realm,ownerKey=credential(realm)) {
  const stage = 'development';
  const db = openStore(root,realm,stage);
  const readerKey = credential(realm);
  const server = await startServer(db,{realm,stage,ownerKey,readerKey,port:0});
  const item = {db,server,ownerKey,readerKey,url:'http://127.0.0.1:'+server.address().port,closed:false};
  instances.push(item);
  return item;
}
async function close(item) {
  if (item.closed) return;
  await new Promise(resolve=>item.server.close(resolve));
  item.db.close();
  item.closed=true;
}
async function api(site,path,method='GET',body,version,token=site.ownerKey) {
  const headers = {};
  if (token) headers.authorization='Bearer '+token;
  if (body !== undefined) headers['content-type']='application/json';
  if (version !== undefined) headers['if-match']='"'+version+'"';
  const response = await fetch(site.url+'/api/v1/'+path,{
    method,headers,body:body === undefined ? undefined : JSON.stringify(body)
  });
  return {code:response.status,data:await response.json()};
}
before(async()=>{
  root=mkdtempSync(join(tmpdir(),'careerops-test-'));
  personal=await instance('personal');
  demo=await instance('demo');
  reader=demo.readerKey;
  seed(demo.db);
});
after(async()=>{
  for(const item of instances) await close(item);
  rmSync(root,{recursive:true,force:true});
});

test('01 migrations are versioned and repeatable; foreign keys and schema integrity pass',()=>{
  const db=openStore(root,'demo','development');
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,2);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.throws(()=>db.prepare("INSERT INTO company_aliases VALUES ('F','missing')").run(),/FOREIGN KEY/);
  } finally { db.close(); }
});
test('02 synthetic seed has three companies and five schedules; retry retains IDs and counts',async()=>{
  assert.equal(seed(demo.db),'already seeded');
  assert.equal((await api(demo,'companies')).data.length,3);
  assert.equal((await api(demo,'job_postings')).data.length,3);
  const {data}=await api(demo,'schedules');
  assert.equal(data.length,5);
  assert.equal(data[1].end_date,'2026-12-04');
  assert.equal(data[2].start_time,null);
  assert.equal(data[4].status,'conditional');
  assert.equal((await api(personal,'companies')).data.length,0);
});
test('03 unsigned, forged hosted identity, viewer writes and cross-instance credentials are denied',async()=>{
  assert.equal((await api(demo,'companies','GET',undefined,undefined,null)).code,401);
  const forged=await fetch(demo.url+'/api/v1/companies',{headers:{'oai-authenticated-user-id':'owner'}});
  assert.equal(forged.status,401);
  assert.equal((await api(personal,'companies','GET',undefined,undefined,demo.ownerKey)).code,401);
  assert.equal((await api(demo,'companies','GET',undefined,undefined,personal.ownerKey)).code,401);
  assert.equal((await api(demo,'companies','GET',undefined,undefined,reader)).code,200);
  assert.equal((await api(demo,'companies','POST',{name:'blocked'},undefined,reader)).code,403);
  assert.equal((await api(demo,'profile','GET',undefined,undefined,reader)).code,403);
  const anonMcp=await fetch(demo.url+'/mcp');
  assert.equal(anonMcp.status,401);
});
test('04 company → posting → schedule CRUD and soft delete preserve audit snapshots',async()=>{
  const add=async(type,data)=>{
    const r=await api(personal,type,'POST',data);
    assert.equal(r.code,201,JSON.stringify(r.data));
    return r.data.id;
  };
  const c=await add('companies',{name:'가상 CRUD 기업'});
  const j=await add('job_postings',{company_id:c,round_key:'2026-A',role_code:'A',title:'합성 직무'});
  const s=await add('schedules',{posting_id:j,kind:'test',title:'가상 과제',start_date:'2026-11-30'});
  assert.equal((await api(personal,'companies/'+c,'DELETE',undefined,1)).code,409);
  const read=await api(personal,'schedules/'+s);
  assert.equal(read.data.start_time,null);
  const edit=await api(personal,'schedules/'+s,'PATCH',{end_date:'2026-12-01'},1);
  assert.equal(edit.data.version,2);
  for(const [type,id,v] of [['schedules',s,2],['job_postings',j,1],['companies',c,1]]){
    assert.equal((await api(personal,type+'/'+id,'DELETE',undefined,v)).code,200);
    assert.equal((await api(personal,type+'/'+id)).code,404);
  }
  const logs=personal.db.prepare('SELECT * FROM change_logs WHERE record_id=? ORDER BY seq').all(s);
  assert.equal(logs.length,3);
  assert.equal(JSON.parse(logs[1].before_json).end_date,null);
  assert.equal(JSON.parse(logs[1].after_json).end_date,'2026-12-01');
  assert.ok(JSON.parse(logs[2].after_json).deleted_at);
});
test('05 racing writers with one version produce exactly one mutation and a stale conflict',async()=>{
  const {data:c}=await api(personal,'companies','POST',{name:'가상 경합 기업'});
  const target='companies/'+c.id;
  const updates=await Promise.all(['first','second'].map(name=>api(personal,target,'PATCH',{size_class:name},1)));
  assert.deepEqual(updates.map(r=>r.code).sort(),[200,409]);
  assert.equal((await api(personal,target)).data.version,2);
  assert.equal(personal.db.prepare('SELECT count(*) n FROM change_logs WHERE record_id=?').get(c.id).n,2);
  assert.equal((await api(personal,target,'DELETE')).code,428);
});
test('06 invalid dates, time bounds, source URLs, unknown fields and duplicate keys are rejected',async()=>{
  const job=(await api(demo,'job_postings')).data[0];
  const data={posting_id:job.id,kind:'test',title:'invalid input',start_date:'2026-12-01'};
  for(const extra of [{start_date:'2026-02-30'},{end_date:'2026-11-30'},{start_time:'25:00'},
    {start_time:'13:00',end_time:'12:00'},{source_url:'data:text/plain,x'},{status:'unknown'},{other:true}]){
    assert.equal((await api(demo,'schedules','POST',{...data,...extra})).code,422);
  }
  assert.equal((await api(demo,'schedules','POST',{...data,posting_id:'missing'})).code,404);
  assert.equal((await api(demo,'companies','POST',{name:'가상 파랑연구소'})).code,409);
  assert.equal((await api(demo,'schedules')).data.length,5);
});
test('07 profile settings round-trip with optimistic editing and realm isolation',async()=>{
  const details={degree:'가상 학위',major:'합성 전공',industry_years:1,research:['합성 연구'],
    technologies:['합성 기술'],languages:['합성 언어'],certifications:[],preferred_regions:['가상 지역'],
    salary_goal:'가상 목표',job_priorities:['가상 직무'],exclusion_rules:['가상 규칙']};
  assert.equal((await api(personal,'profile','PUT',details,1)).code,200);
  assert.deepEqual((await api(personal,'profile')).data.details,details);
  assert.equal((await api(personal,'profile','PUT',{},1)).code,409);
  assert.deepEqual((await api(demo,'profile')).data.details,{});
});
test('08 after service and database restart, schedule IDs, contents and migration survive',async()=>{
  const before=(await api(demo,'schedules')).data;
  const key=demo.ownerKey;
  await close(demo);
  demo=await instance('demo',key);
  assert.deepEqual((await api(demo,'schedules')).data,before);
});
test('09 mismatched on-disk binding, cross-realm configuration and operational seeding fail closed',async()=>{
  const fresh=mkdtempSync(join(root,'test-binding-'));
  const wrong=openStore(fresh,'personal','development');
  wrong.close();
  const other=openStore(fresh,'demo','development');
  other.close();
  copyFileSync(join(fresh,'demo','development','careerops.sqlite'),join(fresh,'personal','development','careerops.sqlite'));
  assert.throws(()=>openStore(fresh,'personal','development'),/mismatch/);
  assert.throws(()=>startServer(demo.db,{realm:'personal',stage:'development'}),/mismatch/);
  assert.throws(()=>startServer(demo.db,{realm:'demo',stage:'development',ownerKey:personal.ownerKey}),/instance-scoped/);
  const op=openStore(fresh,'personal','operational');
  try{
    assert.throws(()=>seed(op),/development storage/);
    assert.equal(op.prepare('SELECT count(*) n FROM companies').get().n,0);
  } finally { op.close(); }
});
test('10 failed audit insert rolls back the associated business mutation',()=>{
  const db=openStore(root,'personal','development');
  try{
    db.exec("CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON change_logs BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
    assert.throws(()=>new CareerService(db).mutate('owner','companies',undefined,undefined,{name:'가상 원자성'}),/audit failure/);
    assert.equal(db.prepare("SELECT count(*) n FROM companies WHERE name='가상 원자성'").get().n,0);
  } finally { db.close(); }
});
test('11 request limits, invalid JSON, client scope selection and profile field types',async()=>{
  const headers={authorization:'Bearer '+demo.ownerKey,'content-type':'application/json'};
  const post=(body)=>fetch(demo.url+'/api/v1/companies',{method:'POST',headers,body});
  assert.equal((await post('{')).status,400);
  assert.equal((await post(JSON.stringify({name:'X'.repeat(20000)}))).status,413);
  assert.equal((await api(demo,'companies?realm=personal')).code,400);
  assert.equal((await api(demo,'profile','PUT',{technologies:'string'},1)).code,422);
});
test('12 interrupted fixture load rolls back all rows and can be retried',()=>{
  const path=mkdtempSync(join(root,'seed-'));
  const db=openStore(path,'demo','development');
  try{
    db.exec("CREATE TEMP TRIGGER fail_fixture BEFORE INSERT ON schedules BEGIN SELECT RAISE(ABORT,'interrupted'); END");
    assert.throws(()=>seed(db),/interrupted/);
    assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM change_logs').get().n,0);
    db.exec('DROP TRIGGER fail_fixture');
    assert.equal(seed(db),'seeded');
  } finally {db.close();}
});
test('13 shared catalog contract on SQLite and a local D1-shaped binding',async()=>{
  const binding = { prepare(sql) { return {bind(...args) { return {
    async all() { return {success:true,results:demo.db.prepare(sql).all(...args)}; }
  }; }}; }};
  const reader = d1Catalog(binding,'demo','development');
  const local = new CareerService(demo.db);
  for (const type of ['companies','job_postings','schedules']) {
    const rows=local.read('reader',type);
    assert.deepEqual(await reader.read(type),rows);
    assert.deepEqual(await reader.read(type,rows[0].id),rows[0]);
    await assert.rejects(reader.read(type,'missing'),{status:404});
  }
  assert.deepEqual(await d1Catalog(binding,'personal','development').read('companies'),[]);
});
test('14 company and round edits preserve distinct roles, and application intent is independent of submission',async()=>{
  const c=(await api(personal,'companies','POST',{name:'합성 회차 기업'})).data;
  const edit=await api(personal,'companies/'+c.id,'PATCH',{institution_type:'fixture'},1);
  assert.equal(edit.data.version,2);
  const input={company_id:c.id,title:'연구',round_key:'A',role_code:'A'};
  const j=(await api(personal,'job_postings','POST',input)).data;
  assert.equal((await api(personal,'job_postings','POST',input)).code,409);
  assert.equal((await api(personal,'job_postings','POST',{...input,round_key:'B'})).code,201);
  assert.equal((await api(personal,'job_postings/'+j.id,'PATCH',{deadline_date:'2026-12-11'},1)).data.deadline_date,'2026-12-11');
  personal.db.prepare("INSERT INTO applications(id,posting_id,user_id,intent) VALUES ('fixture-intent',?,'owner','planned')").run(j.id);
  const application=personal.db.prepare("SELECT stage,submitted_at FROM applications WHERE id='fixture-intent'").get();
  assert.equal(application.stage,'not_submitted');
  assert.equal(application.submitted_at,null);
  assert.equal((await api(personal,'job_postings/'+j.id,'DELETE',undefined,2)).code,409);
});
test('15 altered migration history is rejected on reopen',()=>{
  const path=mkdtempSync(join(root,'migration-'));
  const db=openStore(path,'personal','development');
  db.exec("UPDATE schema_migrations SET sha256='changed'");
  db.close();
  assert.throws(()=>openStore(path,'personal','development'),/checksum changed/);
});
