import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { createSandboxReset } from '../integrations/local/sandbox.mjs';
import { seedPortfolio } from '../fixtures/synthetic/portfolio.mjs';

async function session(t,withReset=true){
  const root=mkdtempSync(join(tmpdir(),'careerops-demo-test-'));
  const realm='demo',stage='development';
  const db=openStore(root,realm,stage);
  let server;
  t.after(async()=>{
    if(server) await new Promise(resolve=>server.close(resolve));
    db.close();rmSync(root,{recursive:true,force:true});
  });
  const counts=seedPortfolio(db,'2026-11-25');
  const key='demo.development.'+randomBytes(32).toString('base64url');
  server=await startServer(db,{realm,stage,ownerKey:key,port:0,sandboxReset:withReset?createSandboxReset(db):undefined});
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,method='GET',body,token=key)=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {db,counts,request,key};
}
test('Portfolio instances isolate credentials, IDs and writes; reset restores the baseline',async t=>{
  const primary=await session(t), other=await session(t);
  const {db,request,counts}=primary;
  assert.deepEqual(counts,{companies:36,postings:72,applications:30,schedules:60,assessments:24,interviews:8,scanRuns:12,rules:12});
  assert.deepEqual(seedPortfolio(db),counts);
  assert.equal(db.prepare('SELECT count(*) n FROM schedules').get().n,60);
  assert.equal(db.prepare("SELECT count(*) n FROM scan_runs WHERE status='failed'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM scan_results WHERE outcome='excluded'").get().n,1);
  assert.equal((await other.request('/api/sandbox','POST',{},primary.key)).status,401);
  const catalog=await (await request('/mcp','POST',{jsonrpc:'2.0',id:'p6-list',method:'tools/list'})).json();
  assert.ok(catalog.result.tools.some(tool=>tool.name==='add_schedule'));
  const workspace=await (await request('/api/v1/workspace')).json();
  const posting=workspace.postings[0];
  const call={jsonrpc:'2.0',id:'p6-write',method:'tools/call',params:{name:'add_schedule',arguments:{key:'trial-1',data:{posting_id:posting.id,title:'New synthetic event',kind:'interview'}}}};
  assert.equal((await (await request('/mcp','POST',call)).json()).result.isError,false);
  assert.equal(db.prepare('SELECT count(*) n FROM schedules').get().n,61);
  assert.equal(other.db.prepare('SELECT count(*) n FROM schedules').get().n,60);
  assert.equal((await other.request('/api/jobs/'+posting.id)).status,404);
  assert.equal((await request('/api/sandbox','POST',{})).status,200);
  assert.equal(db.prepare('SELECT count(*) n FROM schedules').get().n,60);
  assert.equal(db.prepare("SELECT count(*) n FROM tool_calls WHERE call_id='p6-write'").get().n,0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
test('Phase 5 routes serve through the regular HTTP adapter; reset stays unavailable there',async t=>{
  const {request}=await session(t,false);
  assert.deepEqual(await (await request('/api/sandbox')).json(),{enabled:false});
  assert.equal((await request('/api/sandbox','POST',{})).status,404);
  const interviews=(await (await request('/api/records')).json()).items;
  assert.equal(interviews.filter(r=>r.kind==='interview').length,8);
  const command=await (await request('/api/commands','POST',{text:'지원현황'})).json();
  assert.ok(command.items.length>0);
  const exportResult=await (await request('/api/exchange/export?mode=handover')).json();
  assert.ok(exportResult.schemaVersion===1&&exportResult.applications.length===30);
  assert.equal((await request('/assets/advanced.mjs')).status,200);
});
