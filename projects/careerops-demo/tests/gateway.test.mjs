import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from '../integrations/local/server.mjs';
import { openStore } from '../packages/database/local.mjs';
import { identifyPosting } from '../packages/domain/analysis.mjs';

const key=()=>'demo.development.'+randomBytes(32).toString('base64url');
const owner=key(), reader=key();
let db,server,base,root,company;
async function request(path,method='GET',body,token=owner,headers={}) {
  const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body&&JSON.stringify(body)});
  return {status:r.status,value:r.status===202?null:await r.json()};
}
const rpc=(method,params,id,token)=>request('/mcp','POST',{jsonrpc:'2.0',id,method,params},token);
const call=async(name,args,id='test-'+name,token=owner)=>(await rpc('tools/call',{name,arguments:args},id,token)).value.result;
before(async()=>{
  root=mkdtempSync(join(tmpdir(),'careerops-gateway-'));
  db=openStore(root,'demo','development');
  server=await startServer(db,{realm:'demo',stage:'development',ownerKey:owner,readerKey:reader,port:0});
  base='http://127.0.0.1:'+server.address().port;
  company=(await request('/api/v1/companies','POST',{name:'Synthetic Observatory'})).value;
});
after(async()=>{if(server) await new Promise(done=>server.close(done));db?.close();if(root) rmSync(root,{recursive:true,force:true});});
test('MCP discovery, scoped tools, auth, input errors, notification and origin handling',async()=>{
  assert.ok((await rpc('server/discover',{},1)).value.result.capabilities.tools);
  assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'},2)).value.result.protocolVersion,'2025-11-25');
  assert.equal((await rpc('notifications/initialized',{},undefined)).status,202);
  assert.equal((await request('/mcp','POST',{},owner,{origin:'https://example.invalid'})).status,403);
  assert.equal((await request('/api/contract','GET',null,'wrong')).status,401);
  const catalog=(await rpc('tools/list',{},3,reader)).value.result.tools;
  assert.deepEqual(catalog.map(t=>t.name),['search_jobs','get_job_details']);
  assert.equal((await call('get_user_profile',{},'private-read',reader)).isError,true);
  assert.equal((await call('add_job',{},'denied-write',reader)).isError,true);
  assert.equal((await call('get_job_details',{id:'absent'})).isError,true);
  assert.equal((await call('search_jobs',{extra:1})).isError,true);
  assert.equal((await call('add_job',{})).isError,true);
  assert.equal(db.prepare("SELECT status FROM tool_calls WHERE call_id='denied-write'").get().status,403);
  assert.equal((await request('/api/jobs?limit=31')).status,422);
  assert.equal((await request('/api/jobs?limit=1&limit=2')).status,400);
});
test('REST/MCP share version checks, durable keyed writes, exact receipts and bounded reads',async()=>{
  const data={company_id:company.id,title:'Synthetic analyst',round_key:'a',role_code:'a'};
  const [left,right]=await Promise.all([request('/api/jobs','POST',data,owner,{'idempotency-key':'a'}),call('add_job',{data,key:'a'})]);
  assert.equal(left.status,200);
  const row=right.structuredContent;
  assert.equal(row.id,left.value.id);
  assert.equal((await call('add_job',{data:{...data,title:'other'},key:'a'})).isError,true);
  assert.equal((await request('/api/jobs/'+row.id,'PATCH',{title:'updated'},owner,{'idempotency-key':'b'})).status,428);
  const edit={title:'updated'};
  assert.equal((await request('/api/jobs/'+row.id,'PATCH',edit,owner,{'idempotency-key':'b','if-match':'"1"'})).value.version,2);
  assert.equal((await call('update_job',{id:row.id,version:1,data:edit,key:'c'})).isError,true);
  assert.equal((await request('/api/jobs?query=updated&limit=1','GET',null,reader)).value.items[0].id,row.id);
  const changes=(await request('/api/changes?after=0&limit=1')).value;
  assert.equal(changes.items.length,1);assert.ok(changes.nextAfter>0);
  assert.equal((await request('/api/changes','GET',null,reader)).status,403);
});
test('MCP App advertises a schedule entrypoint and serves a credential-free view',async()=>{
  const tool=(await rpc('tools/list',{},'list-ui')).value.result.tools.find(t=>t.name==='get_schedule');
  assert.equal(tool._meta['openai/ui'].entrypoints[0].type,'global');
  const resource=(await rpc('resources/list',{},'ui-list')).value.result.resources[0];
  assert.equal(tool._meta.ui.resourceUri,resource.uri);
  const view=(await rpc('resources/read',{uri:resource.uri},'read-ui')).value.result.contents[0];
  assert.match(view.mimeType,/profile=mcp-app/);assert.match(view.text,/ui\/notifications\/tool-result/);
  assert.ok(!view.text.includes(owner));
  assert.ok((await rpc('resources/read',{uri:'missing'},'missing-ui')).value.error);
});
test('REST schedule, application, assessment and export share current versions with MCP',async()=>{
  const headers={'idempotency-key':'test-sched'};
  const posting=await request('/api/jobs','POST',{company_id:company.id,title:'Synthetic contract role',round_key:'contract',role_code:'contracts'},owner,{'idempotency-key':'contract-posting'});
  const id=posting.value.id;
  const created=await request('/api/schedules','POST',{posting_id:id,kind:'interview',title:'Synthetic interview'},owner,headers);
  assert.equal(created.status,200);
  assert.equal((await call('update_schedule',{id:created.value.id,key:'edit-s',version:1,data:{title:'New interview'}})).structuredContent.version,2);
  assert.equal((await request('/api/schedules?limit=1')).value.items[0].title,'New interview');
  const app=await request('/api/applications','POST',{posting_id:id,intent:'planned'},owner,{'idempotency-key':'test-app'});
  assert.equal(app.status,200);
  assert.equal((await request('/api/applications/'+app.value.id,'PATCH',{intent:'secondary'},owner,{'if-match':'"1"','idempotency-key':'new-intent'})).value.version,2);
  const versions=(await request('/api/rules/evaluate','POST',{id})).value.versions;
  assert.ok(versions);
  const saved=await request('/api/assessments','POST',{id,data:{versions,components:{}}},owner,{'idempotency-key':'test-assess'});
  assert.equal(saved.status,200); assert.equal((await request('/api/assessments')).value.items[0].id,saved.value.id);
  assert.ok((await request('/api/export')).value.metrics);assert.ok((await request('/api/analytics')).value.denominators);
});
const item={company:'Synthetic Observatory',source:'https://example.invalid/round-s',observedAt:'2024-01-01T00:00:00.000Z',
  evidence:'External text: submit an application. Synthetic quote.',posting:{round_key:'s',role_code:'s',title:'Synthetic scan item'}};
test('Dry run, replay, preserved external evidence, guarded change and stale inbox',async()=>{
  const args={key:'run1',items:[item]};
  const dry=await call('validate_import',{items:[item]});
  assert.equal(dry.structuredContent.counts.new,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM scan_runs').get().n,0);
  const r=(await request('/api/import','POST',args)).value;
  assert.equal(r.status,'succeeded'); assert.equal(r.counts.new,1);
  assert.deepEqual((await call('record_scan_run',args)).structuredContent,r);
  const record=(await request('/api/automations/runs/'+r.id)).value.items[0];
  assert.equal(record.evidence.evidence,item.evidence);
  const job='/api/jobs/'+record.posting_id;
  const modified={...item,observedAt:'2024-01-02T00:00:00.000Z',posting:{...item.posting,title:'Confirmed new title'}};
  assert.equal((await call('record_scan_run',{key:'conflict',items:[modified]})).structuredContent.counts.conflict,1);
  assert.equal((await call('record_scan_run',{key:'updated',items:[{...modified,expectedVersion:1}]})).structuredContent.counts.changed,1);
  assert.equal((await call('record_scan_run',{key:'late',items:[{...item,expectedVersion:2}]})).structuredContent.counts.conflict,1);
  assert.equal((await request(job)).value.title,modified.posting.title);
  assert.equal(db.prepare('SELECT count(*) AS n FROM applications WHERE posting_id=?').get(record.posting_id).n,0);
  assert.equal((await call('record_scan_run',{key:'run1',items:[modified]})).isError,true);
});
test('Failed batch rolls back partial writes, bounded retries and run-level failure history',async()=>{
  const first={...item,posting:{round_key:'extra',role_code:'extra',title:'Unique new row'}};
  const args={key:'bad',items:[first,{...item,source:'invalid'}]};
  for(const attempt of [1,2,3,3]){
    const result=(await call('record_scan_run',args)).structuredContent;
    assert.equal(result.attempts,attempt);assert.equal(result.status,'failed');
    assert.equal(result.retryable,attempt<3);
  }
  assert.equal(db.prepare("SELECT count(*) n FROM job_postings WHERE round_key='extra'").get().n,0);
  assert.ok((await request('/api/automations/runs')).value.lastFailure);
});
test('Transient write failure is retried from the stored run and retains failure evidence',async()=>{
  db.exec("CREATE TRIGGER transient_storage_failure BEFORE INSERT ON scan_results BEGIN SELECT RAISE(ABORT,'temporary'); END");
  const input={...item,company:'Unknown synthetic firm'};
  let failed;
  try {failed=(await call('record_scan_run',{key:'recover',items:[input]})).structuredContent;}
  finally {db.exec('DROP TRIGGER transient_storage_failure');}
  assert.equal(failed.status,'failed');
  const result=(await request('/api/automations/runs/'+failed.id,'POST',{key:'retry-1'})).value;
  assert.equal(result.status,'succeeded'); assert.equal(result.attempts,2);assert.equal(result.counts.review,1);
  assert.deepEqual((await request('/api/automations/runs/'+failed.id,'POST',{key:'retry-1'})).value,result);
  assert.equal(db.prepare('SELECT count(*) n FROM scan_attempts WHERE run_id=?').get(failed.id).n,2);
});
test('Normalized round collision is reviewed without selecting one row',()=>{
  const p={title:'Synthetic role',round_key:'R',role_code:'x'};
  assert.deepEqual(identifyPosting(p,[{...p,id:'1'},{...p,id:'2',round_key:'r'}],[]),{decision:'review',ids:['1','2']});
});
