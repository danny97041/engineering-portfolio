import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../packages/database/local.mjs';
import { snapshot,restore } from '../packages/database/recovery.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { importBatch } from '../packages/application/exchange.mjs';
import { command } from '../packages/application/commands.mjs';
import { records,writeRecord } from '../packages/application/records.mjs';
import { addDays,seoulDate } from '../packages/domain/workflow.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/synthetic/exchange-v1.json',import.meta.url),'utf8'));
function withStore(t){
  const root=mkdtempSync(join(tmpdir(),'careerops-phase5-'));
  const db=openStore(root,'demo','development');
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  return {db,root,service:new CareerService(db)};
}
test('Work batch preview rolls back, isolates rejected rows, resolves references and replays',t=>{
  const {db,service}=withStore(t);
  const batch={...fixture,items:[...fixture.items,{ref:'bad',type:'schedules',data:{posting_id:{$ref:'unknown'},title:'Invalid',kind:'interview'}}]};
  const planned=importBatch(service,'owner',batch,true);
  assert.deepEqual(planned.rows.map(r=>r.ok),[true,true,true,true,false]);
  assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n,0);
  const actual=importBatch(service,'owner',batch);
  assert.deepEqual(actual.rows.map(r=>r.ok),planned.rows.map(r=>r.ok));
  assert.equal(importBatch(service,'owner',batch).replayed,true);
  assert.throws(()=>importBatch(service,'owner',{...batch,items:fixture.items}),/reused/);
  assert.throws(()=>importBatch(service,'reader',batch),/Write access required/);
  const [,,study,interview]=actual.rows;
  assert.throws(()=>writeRecord(service,'owner',{id:study.id,version:1,remove:true}),/referenced/);
  const current=records(service,'owner',{id:interview.id});
  const edit=writeRecord(service,'owner',{id:interview.id,version:1,data:{...current.data,completed:true}});
  assert.equal(edit.version,2);
  assert.throws(()=>writeRecord(service,'owner',{id:interview.id,version:1,remove:true}),/changed/);
  writeRecord(service,'owner',{id:interview.id,version:2,remove:true});
  assert.throws(()=>records(service,'owner',{id:interview.id}),/not found/);
});
test('Command previews exact round before submission and keeps closed schedule history',t=>{
  const {service}=withStore(t);
  const [org,post]=importBatch(service,'owner',fixture).rows;
  service.mutate('owner','job_postings',undefined,undefined,{company_id:org.id,title:'Another role',round_key:'new',role_code:'cfd'});
  assert.equal(command(service,'owner',{text:'Synthetic Prism Research 지원완료'}).ambiguous,true);
  service.mutate('owner','schedules',undefined,undefined,{posting_id:post.id,title:'Future',kind:'interview',start_date:addDays(seoulDate(),3)});
  assert.equal(command(service,'owner',{text:'일정표'}).items.length,1);
  const execute=(verb,key)=>{
    const text='Synthetic Prism Research / sample-1 '+verb;
    const p=command(service,'owner',{text}).proposed;
    const request={text,confirmation:{postingId:p.postingId,postingVersion:p.postingVersion,applicationVersion:p.applicationVersion,key}};
    const result=command(service,'owner',request);
    assert.deepEqual(command(service,'owner',request),{...result});
    return result;
  };
  assert.ok(execute('지원완료','submit').submitted_at);
  assert.equal(execute('X','close').stage,'rejected');
  assert.equal(command(service,'owner',{text:'일정표'}).items.length,0);
  assert.equal(service.db.prepare('SELECT count(*) n FROM schedules').get().n,1);
});
test('Full and incremental restore reconstruct different SQLite states without replacing the source',t=>{
  const {db,root,service}=withStore(t);
  const base=join(root,'base.db'),delta=join(root,'delta.json');
  snapshot(db,base);
  importBatch(service,'owner',fixture);
  assert.ok(snapshot(db,delta,base).changedBlocks>0);
  const clean=join(root,'clean.db'),latest=join(root,'latest.db'),binding=service.binding;
  restore(base,clean,binding);
  restore(base,latest,binding,delta);
  for(const [path,count] of [[clean,0],[latest,2]]){
    const copy=new DatabaseSync(path,{readOnly:true});
    try {
      assert.equal(copy.prepare('SELECT count(*) n FROM career_records').get().n,count);
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    } finally {copy.close();}
  }
  assert.throws(()=>restore(base,latest,binding),/already exists/);
  assert.throws(()=>restore(base,join(root,'other.db'),{realm:'personal',stage:'development'}),/binding/);
});
