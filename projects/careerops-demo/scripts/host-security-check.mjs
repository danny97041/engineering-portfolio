import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [nextPath,priorPath]=process.argv.slice(2);
if(!nextPath||!priorPath) throw Error('Provide new and previous Personal Worker JS builds');
const load=async path=>(await import(pathToFileURL(resolve(path)))).default;
const [next,prior]=await Promise.all([load(nextPath),load(priorPath)]);
const sql=new DatabaseSync(':memory:');
try{
  for(const file of ['revisions.sql','tool-calls.sql']){
    sql.exec(readFileSync(new URL('../integrations/sites/host/'+file,import.meta.url),'utf8'));
  }
  const DB={
    prepare(query){
      const bound=args=>({bind:(...values)=>bound(values),first:()=>sql.prepare(query).get(...args),
        all:()=>({results:sql.prepare(query).all(...args)}),run:()=>sql.prepare(query).run(...args)});
      return bound([]);
    },
    batch(statements){
      sql.exec('BEGIN');
      try {const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}
      catch(error){sql.exec('ROLLBACK');throw error;}
    }
  };
  const env={DB,CAREEROPS_SCAN_READ_KEY:'a'.repeat(43),CAREEROPS_SCAN_WRITE_KEY:'b'.repeat(43),CAREEROPS_SCAN_OWNER:'owner-fixture'};
  const address='https://example.invalid';
  const owner='owner-fixture',other='other-fixture';
  const route=async(worker,path,{user=owner,method='GET',body,headers={}}={})=>{
    const request=new Request(address+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),
      ...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    return worker.fetch(request,env);
  };
  const post=(worker,path,body,options={})=>route(worker,path,{method:'POST',body,...options});
  const call=(worker,name,args,options={})=>post(worker,'/mcp',{jsonrpc:'2.0',id:'host-'+name,method:'tools/call',params:{name,arguments:args}},options);
  async function json(responsePromise,status=200){
    const response=await responsePromise;
    const data=await response.json();
    assert.equal(response.status,status,JSON.stringify(data));
    return data;
  }
  const company=await json(post(prior,'/api/v1/companies',{name:"Fixture Engineer's Lab"}),201);
  const posting=await json(post(prior,'/api/v1/job_postings',{company_id:company.id,round_key:'fixture-1',role_code:'thermal',title:'Synthetic closed role',deadline_date:'2020-01-01'}),201);
  const stored=await json(route(next,'/api/v1/workspace'));
  assert.ok(stored.closedPostingIds.includes(posting.id));
  const fitPath='/api/fit/'+posting.id;
  assert.deepEqual(await json(route(next,fitPath)),{fit:null});
  for(const path of ['/api/v1/workspace','/api/recovery/download',fitPath]){
    const r=await route(next,path,{user:null});
    assert.equal(r.status,401);
    assert.match(r.headers.get('cache-control'),/private, no-store/);
    assert.ok(!(await r.text()).includes(posting.id));
  }
  await json(route(next,fitPath,{user:other}),404);
  const fit={key:'isolated-fit',version:0,postingVersion:1,asOf:'2020-01-01',reason:"Engineer's assessment",
    scores:{overall_fit:{min:72,max:80,source:'https://example.invalid/jd',status:'provisional',evidence:'Role requirements'}}};
  await json(post(next,fitPath,fit,{user:other}),404);
  await json(post(next,fitPath,fit,{headers:{'sec-fetch-site':'cross-site'}}),403);
  assert.equal((await json(post(next,fitPath,fit))).scores.overall_fit.min,72);
  const access=key=>({user:null,headers:{'x-careerops-scan-key':key}});
  const read=access(env.CAREEROPS_SCAN_READ_KEY),write=access(env.CAREEROPS_SCAN_WRITE_KEY);
  assert.equal((await json(call(next,'get_dashboard',{},read))).result.structuredContent.metrics.candidates,1);
  await json(call(next,'import_job_batch',{},read),403);
  await json(call(next,'update_application_status',{},write),403);
  assert.equal((await route(next,'/api/recovery/download',write)).status,403);

  const backupResponse=await route(next,'/api/recovery/download');
  assert.equal(backupResponse.status,200);
  assert.equal(new Uint8Array(await backupResponse.arrayBuffer()).length>4096,true);
  const recovery=await json(route(next,'/api/recovery'));
  assert.equal(recovery.revision,3);
  await json(post(next,'/api/recovery',{expected:recovery.revision,restore:2}));
  assert.equal((await json(route(next,fitPath))).fit,null);
  assert.ok((await json(route(next,'/api/v1/workspace'))).closedPostingIds.includes(posting.id));
  assert.equal((await json(route(next,'/api/v1/companies')))[0].name,"Fixture Engineer's Lab");
  console.log('PASS isolated Worker: snapshot migration, identity/realm paths, CSRF, scoped keys, backup and restore');
} finally{sql.close();}
