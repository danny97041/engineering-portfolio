import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {sha256} from '../web/model.mjs';
export class TestBucket {
  objects=new Map();
  async get(key){const x=this.objects.get(key);return x?{etag:x.hash,json:async()=>JSON.parse(x.value)}:null;}
  async head(key){return this.objects.has(key)?{}:null;}
  async put(key,value,options){const prior=this.objects.get(key),guard=options.onlyIf;
    if(guard.etagMatches && guard.etagMatches!==prior?.hash || guard.etagDoesNotMatch==='*' && prior)return null;
    const hash=String(this.objects.size+1)+'-'+Math.random();this.objects.set(key,{value,hash});return {etag:hash};}
}
if(process.env.LAB_TEST_WORKER)test('owner-only registry, checksum, duplicate, immutable conflicts and live catalog',async()=>{
  const worker=(await import(pathToFileURL(resolve(process.env.LAB_TEST_WORKER)))).default;
  const env={BUCKET:new TestBucket(),LAB_OWNER_EMAIL:'owner@example.test'},origin='http://lab.test';
  const call=(path,method='GET',body,owner=true,requestOrigin=origin)=>worker.fetch(new Request(origin+path,{method,
    headers:{origin:requestOrigin,...(owner?{'oai-authenticated-user-id':'test','oai-authenticated-user-email':env.LAB_OWNER_EMAIL}:{})},body}),env);
  assert.equal((await call('/data/catalog.json','GET',undefined,false)).status,403);
  assert.equal((await call('/api/import/preview','POST','{}',true,'http://other.test')).status,403);
  const artifact=new TextEncoder().encode('{"metric":0.4}'),hash=await sha256(artifact);
  const m={schema:'physicsai.run.v1',id:'heat-test',version:'test-v1',equation:'heat2d',arm:'baseline',seed:7,
    field_l2:0.4,field_points:'fixed_grid',sourceSha256:hash,file:'metrics.json',lambda_error:null,adam_iteration:10};
  const post=(op,data)=>call('/api/import/'+op,'POST',JSON.stringify(data));
  assert.equal((await (await post('preview',m)).json()).status,'new');
  assert.equal((await post('approve',m)).status,422);
  assert.equal((await call('/api/import/artifact/'+hash,'PUT','bad')).status,422);
  assert.equal((await call('/api/import/artifact/'+hash,'PUT',artifact)).status,200);
  assert.equal((await post('approve',m)).status,201);
  assert.equal((await (await post('approve',m)).json()).status,'duplicate');
  assert.equal((await post('approve',{...m,seed:9})).status,409);
  assert.equal((await post('preview',{...m,extra:'wrong'})).status,422);
  const cat=await (await call('/data/catalog.json')).json();
  assert.equal(cat.runs.length,66);assert.equal(cat.runs.at(-1).sha256,null);
  for(const [tool,args] of [['search',{query:'heat-test'}],['compare',{equation:'heat2d'}],['metrics',{id:'heat-test'}],['predict',{id:'heat2d-baseline-3234',points:[[0.2,0.3,0.4]]}]]){
    const result=await call('/api/research','POST',JSON.stringify({tool,arguments:args}));assert.equal(result.status,200);
    if(tool==='search')assert.ok((await result.json()).results.some(h=>h.id==='heat-test'));
  }
  assert.equal((await call('/api/research','POST',JSON.stringify({tool:'delete',arguments:{}}))).status,422);
});
