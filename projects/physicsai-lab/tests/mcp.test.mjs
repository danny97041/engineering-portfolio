import assert from 'node:assert/strict';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {TestBucket} from './worker.test.mjs';
import {sha256} from '../web/model.mjs';

if(process.env.LAB_TEST_WORKER)test('MCP discovery, owner boundary, tools and newly registered results',async()=>{
  const worker=(await import(pathToFileURL(resolve(process.env.LAB_TEST_WORKER)))).default;
  const env={LAB_OWNER_EMAIL:'owner@example.test',BUCKET:new TestBucket()},url='https://test.invalid';
  const headers={'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':env.LAB_OWNER_EMAIL};
  async function rpc(method,params,identity=headers){
    const response=await worker.fetch(new Request(url+'/mcp',{method:'POST',headers:identity,
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);
    return {status:response.status,body:await response.json()};
  }
  assert.deepEqual((await rpc('server/discover',{},{})).body.result.supportedVersions,['2026-07-28']);
  const listed=(await rpc('tools/list')).body.result.tools.map(t=>t.name);
  assert.equal(listed.length,12);
  assert.ok(!listed.some(t=>/predict|publish|import/.test(t)));
  const request=name=>({name,arguments:{}});
  assert.equal((await rpc('tools/call',request('list_pdes'),{})).status,403);
  assert.equal((await rpc('tools/call',request('list_pdes'),{...headers,'oai-authenticated-user-email':'other@example.test'})).status,403);
  assert.equal((await rpc('tools/call',request('list_pdes'),{...headers,origin:'https://other.test'})).status,403);
  async function invoke(name,args={}){
    const reply=(await rpc('tools/call',{name,arguments:args})).body.result;
    assert.equal(reply.isError,undefined);
    return reply.structuredContent;
  }
  const id='heat2d-baseline-3234';
  for(const [name,args] of [
    ['list_pdes',{}],['list_experiments',{equation:'heat2d',limit:2}],['compare_pinn_methods',{equation:'heat2d'}],
    ['get_experiment_metrics',{id}],['get_model_info',{id}],['search_research_documents',{query:'heat2d'}],
    ['get_validation_results',{id}],['generate_technical_summary',{id}],['get_release_info',{}],
    ['get_experiment_lineage',{id}],['list_model_versions',{equation:'heat2d'}]
  ])assert.ok(await invoke(name,args));
  assert.equal((await invoke('get_field_data',{id,stride:3})).indices.at(-1),16);
  assert.equal((await rpc('tools/call',{name:'list_pdes',arguments:{extra:1}})).body.result.isError,true);
  assert.equal((await rpc('tools/call',request('predict_pde'))).body.error.code,-32602);

  const body='{"field_l2":0.25}',hash=await sha256(new TextEncoder().encode(body));
  const send=(path,method,body)=>worker.fetch(new Request(url+path,{method,headers:{...headers,origin:url},body}),env);
  assert.equal((await send('/api/import/artifact/'+hash,'PUT',body)).status,200);
  const m={schema:'physicsai.run.v1',id:'heat-mcp-fixture',version:'test-v1',equation:'heat2d',arm:'baseline',seed:904,
    field_l2:0.25,field_points:'test_grid',sourceSha256:hash,file:'metrics.json',lambda_error:null,adam_iteration:10};
  assert.equal((await send('/api/import/approve','POST',JSON.stringify(m))).status,201);
  assert.equal((await invoke('get_experiment_metrics',{id:m.id})).field_l2,0.25);
  assert.ok((await invoke('search_research_documents',{query:m.id})).results.some(r=>r.id===m.id));
});
