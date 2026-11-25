import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/database/local.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { callTool } from '../packages/mcp/gateway.mjs';

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'careerops-release-')),db=openStore(root,'demo','development');
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  return new CareerService(db);
}
test('T13 exact deadline correction commits posting, linked calendar and source history atomically',t=>{
  const s=fixture(t);
  const org=s.mutate('owner','companies',undefined,undefined,{name:'Synthetic release company'});
  const p=s.mutate('owner','job_postings',undefined,undefined,{company_id:org.id,role_code:'r',round_key:'1',title:'Synthetic role',deadline_date:'2026-12-01'});
  const event=s.mutate('owner','schedules',undefined,undefined,{posting_id:p.id,kind:'deadline',title:'Deadline',start_date:'2026-12-01'});
  const args={postingId:p.id,postingVersion:1,scheduleId:event.id,scheduleVersion:1,date:'2026-12-03',time:'14:30',source:'https://example.invalid/change',verifiedOn:'2026-11-25',evidence:'Synthetic official notice',key:'notice1'};
  assert.throws(()=>callTool(s,'owner','confirm_official_deadline',{...args,scheduleVersion:2}),/changed/);
  assert.equal(s.read('owner','job_postings',p.id).deadline_date,'2026-12-01');
  const receipt=callTool(s,'owner','confirm_official_deadline',args);
  assert.equal(receipt.scheduleVersion,2);assert.deepEqual(callTool(s,'owner','confirm_official_deadline',args),receipt);
  assert.equal(s.read('owner','schedules',event.id).end_time,'14:30');
  assert.equal(s.read('owner','job_postings',p.id).deadline_date,'2026-12-03');
  assert.equal(s.relations('job_postings',p.id).sources[0].verified_on,'2026-11-25');
  for(const id of [p.id,event.id]) assert.equal(s.db.prepare('SELECT count(*) n FROM change_logs WHERE record_id=? AND before_json IS NOT NULL').get(id).n,1);
});
test('Work MCP previews, applies and safely replays the exchange contract',t=>{
  const s=fixture(t),args={key:'exchange',schemaVersion:1,items:[{ref:'org',type:'companies',data:{name:'Synthetic transfer'}}]};
  assert.equal(callTool(s,'owner','preview_work_batch',args).rows[0].ok,true);
  assert.equal(s.read('owner','companies').length,0);
  const applied=callTool(s,'owner','apply_work_batch',args);
  assert.deepEqual(callTool(s,'owner','apply_work_batch',args),JSON.parse(JSON.stringify(applied)));
  assert.equal(s.read('owner','companies').length,1);
  assert.throws(()=>callTool(s,'reader','preview_work_batch',args),/Write access/);
});
test('Bounded search crosses chunks and retains Unicode matching and page cursors',t=>{
  const s=fixture(t);
  s.db.exec("INSERT INTO companies(id,name) VALUES ('c','Synthetic')");
  const insert=s.db.prepare("INSERT INTO job_postings(id,company_id,round_key,role_code,title) VALUES (?,'c',?,'demo',?)");
  for(let i=0;i<300;i++) insert.run('p'+String(i).padStart(3,'0'),String(i),i%13===0?'Kelvin':'Synthetic');
  const page=callTool(s,'reader','search_jobs',{query:'kelvin',offset:19,limit:4});
  assert.deepEqual(page.items.map(r=>r.id),['p247','p260','p273','p286']);assert.equal(page.nextOffset,23);
  assert.equal(callTool(s,'reader','search_jobs',{query:'kelvin',offset:23,limit:4}).nextOffset,null);
});
test('Work migration preserves historical dates, terminal stages, source and unknown dates',t=>{
  const s=fixture(t),org=s.mutate('owner','companies',undefined,undefined,{name:'Synthetic history'});
  const items=['submitted','rejected','not_submitted'].map((stage,i)=>{
    const posting=s.mutate('owner','job_postings',undefined,undefined,{company_id:org.id,round_key:'r'+i,role_code:'r',title:'History'});
    return {ref:'a'+i,type:'applications',data:{posting_id:posting.id,stage,history:{source:'Synthetic dated handover',submittedOn:i===0?'2025-01-01':null}}};
  });
  const result=callTool(s,'owner','apply_work_batch',{key:'history',schemaVersion:1,items});
  assert.ok(result.rows.every(r=>r.ok));
  const select=s.db.prepare('SELECT stage,submitted_at FROM applications WHERE id=?');
  assert.equal(select.get(result.rows[0].id).submitted_at,'2025-01-01');
  assert.equal(select.get(result.rows[1].id).stage,'rejected');
  assert.equal(select.get(result.rows[1].id).submitted_at,null);
  assert.equal(s.db.prepare("SELECT count(*) n FROM application_events WHERE source='import: Synthetic dated handover'").get().n,3);
});
