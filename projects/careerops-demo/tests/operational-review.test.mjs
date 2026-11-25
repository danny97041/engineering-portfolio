import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/database/local.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { createHandler } from '../packages/api/http.mjs';
import { intakeQueue,resolveIntake } from '../packages/application/analysis.mjs';
import { callTool } from '../packages/mcp/gateway.mjs';
import { workspace } from '../packages/application/workspace.mjs';
import { scanAccess,allowedScanTool } from '../integrations/sites/host/scan-authorization.mjs';


const actor='owner';
const ownerKey='demo.development.'+'a'.repeat(43);
const viewerKey='demo.development.'+'b'.repeat(43);

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'careerops-review-'));
  const db=openStore(root,'demo','development');
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  const service=new CareerService(db);
  const company=service.mutate(actor,'companies',undefined,undefined,{name:"Engineer's Lab"});
  const add=(round,extra={})=>service.mutate(actor,'job_postings',undefined,undefined,
    {company_id:company.id,title:"Engineer's role",role_code:'example',round_key:round,...extra});
  const http=createHandler(service,'demo','development',ownerKey,viewerKey);
  const request=(path,key,body)=>http(new Request('https://example.invalid'+path,{
    method:body?'POST':'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:body&&JSON.stringify(body)
  }));
  return {db,service,company,add,request};
}

test('Five fit ratings preserve ranges, uncertainty and legacy data across revisions',async t=>{
  const {db,service,add,request}=fixture(t);
  const row=add('rating'),path='/api/fit/'+row.id;
  const scored={min:74,max:81,status:'provisional',source:'https://example.invalid/source',evidence:"Engineer's verified notes"};
  const input={key:'score-1',version:0,postingVersion:1,asOf:'2025-06-03',reason:'First explicit evaluation',scores:{overall_fit:scored,ai_project_fit:null}};
  assert.equal((await request(path,viewerKey,input)).status,403);
  assert.equal((await request(path,ownerKey,{...input,scores:{overall_fit:{...scored,min:82}}})).status,422);
  const first=await(await request(path,ownerKey,input)).json();
  assert.deepEqual(await(await request(path,ownerKey,input)).json(),first);
  assert.equal(first.version,1);
  assert.equal(first.scores.ai_project_fit,null);
  assert.equal(Object.keys(first.scores).length,5);
  assert.equal((await request(path,ownerKey,{...input,key:'second'})).status,409);
  assert.deepEqual(first.scores.overall_fit,scored);
  service.mutate(actor,'job_postings',row.id,1,{title:'Updated wording'});
  assert.equal((await(await request(path,ownerKey)).json()).fit.stale,true);
  assert.equal(db.prepare('SELECT count(*) n FROM assessments').get().n,0);
});

test('Closed postings are retained and are excluded from current unreviewed counts',t=>{
  const {service,add}=fixture(t);
  const prior=add('previous',{deadline_date:'2020-01-02',review_status:'new'});
  const done=add('closed',{posting_status:'closed',review_status:'reviewed'});
  const upcoming=add('current',{review_status:'unreviewed'});
  const w=workspace(service,actor);
  assert.deepEqual(new Set(w.closedPostingIds),new Set([prior.id,done.id]));
  assert.equal(w.metrics.unreviewed,1);
  assert.deepEqual(callTool(service,actor,'get_unreviewed_jobs',{}).items.map(r=>r.id),[upcoming.id]);
  assert.equal(callTool(service,'reader','search_jobs',{query:"Engineer's"}).items.length,3);
});

test('Review approvals preserve origin, prevent duplicates and reject stale targets',t=>{
  const {service,company,add,db}=fixture(t);
  const source='https://example.invalid/review',note='Official source evidence';
  const item={company:'Pending discovery',source,observedAt:'2020-01-02T00:00:00.000Z',evidence:note,
    posting:{title:'Review posting',role_code:'example',round_key:'new'}};
  const review=(key,origin='manual')=>{
    const r=callTool(service,actor,'record_scan_run',{key,origin,items:[item]});
    assert.equal(r.counts.review,1);
    return intakeQueue(service,actor).find(row=>row.batch&&row.posting.title===item.posting.title&&!row.disposition);
  };
  const first=review('review-a');
  assert.equal(first.origin,'manual');
  const request={key:'approval-a',version:1,action:'approve',companyId:company.id,reason:note};
  assert.throws(()=>resolveIntake(service,'reader',first.id,request),/Write access/);
  const receipt=resolveIntake(service,actor,first.id,request);
  assert.deepEqual(resolveIntake(service,actor,first.id,request),receipt);
  const second=review('review-b','scheduled');
  assert.equal(second.origin,'scheduled');
  assert.throws(()=>resolveIntake(service,actor,second.id,{...request,key:'approval-b'}),/duplicate/);
  service.mutate(actor,'companies',company.id,1,{aliases:['Pending discovery']});
  const existing=service.read(actor,'job_postings',receipt.postingId);
  const other=add('different');
  const merge={key:'source-merge',version:1,action:'merge',postingId:existing.id,postingVersion:existing.version,reason:note};
  assert.throws(()=>resolveIntake(service,actor,second.id,{...merge,postingVersion:40}),/Posting changed/);
  assert.throws(()=>resolveIntake(service,actor,second.id,{...merge,postingId:other.id}),/same company, round and role/);
  assert.equal(resolveIntake(service,actor,second.id,merge).disposition,'merged');
  assert.equal(db.prepare('SELECT count(*) n FROM applications').get().n,0);
});

test('Scoped scan keys guard read, write and realm independently',()=>{
  const read='a'.repeat(43),write='b'.repeat(43),header=value=>new Headers({'x-careerops-scan-key':value});
  const env={CAREEROPS_SCAN_READ_KEY:read,CAREEROPS_SCAN_WRITE_KEY:write,CAREEROPS_SCAN_OWNER:'synthetic-principal'};
  const reader=scanAccess('personal',header(read),env),writer=scanAccess('personal',header(write),env);
  assert.equal(allowedScanTool(reader,'search_jobs'),true);
  assert.equal(allowedScanTool(reader,'import_job_batch'),false);
  assert.equal(allowedScanTool(writer,'import_job_batch'),true);
  assert.equal(allowedScanTool(writer,'update_application_status'),false);
  assert.equal(scanAccess('demo',header(read),env).denied,true);
  assert.equal(scanAccess('personal',header(read),{...env,CAREEROPS_SCAN_WRITE_KEY:read}).denied,true);
});
