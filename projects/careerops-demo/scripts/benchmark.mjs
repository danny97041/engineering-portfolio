import { tmpdir,cpus,platform,arch } from 'node:os';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { openStore,transaction } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { reviewPosting } from '../packages/application/analysis.mjs';
import { importBatch } from '../packages/application/exchange.mjs';
import { callTool } from '../packages/mcp/gateway.mjs';
const results=[];
const repeats=12,warmups=2;
async function measure(n,operation,fn){
  const samples=[];let bytes;
  for(let i=0;i<repeats+warmups;i++){
    const started=performance.now();
    const result=await fn(i);
    const elapsed=performance.now()-started;
    if(i>=warmups) samples.push(elapsed);
    bytes=result?.bytes;
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  results.push({n,operation,mean:samples.reduce((a,b)=>a+b)/samples.length,median:(sorted[5]+sorted[6])/2,p95:sorted[Math.ceil(0.95*sorted.length)-1],bytes,samples});
}
for(const n of [100,1000,10000]){
  const root=mkdtempSync(join(tmpdir(),'careerops-perf-'));
  const db=openStore(root,'demo','development');
  let server;
  try {
    const service=new CareerService(db);
    transaction(db,()=>{
      const org=db.prepare('INSERT INTO companies(id,name) VALUES (?,?)');
      const post=db.prepare('INSERT INTO job_postings(id,company_id,round_key,role_code,title) VALUES (?,?,?,?,?)');
      for(let i=0;i<n;i++){
        const company='c'+Math.floor(i/20);
        if(i%20===0) org.run(company,'Synthetic '+company);
        post.run('p'+i,company,'r'+i,i%5===0?'thermal':'physics','Synthetic position '+i);
      }
    });
    const ownerKey='demo.development.'+randomBytes(32).toString('base64url');
    server=await startServer(db,{realm:'demo',stage:'development',port:0,ownerKey});
    const base='http://127.0.0.1:'+server.address().port;
    const http=async(path,body)=>{
      const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+ownerKey,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
      const text=await r.text();assert.ok(r.ok);
      const value=JSON.parse(text);assert.ok(!value.result?.isError);
      return {value,bytes:Buffer.byteLength(text)};
    };
    await measure(n,'REST search / role filter',async()=>{const r=await http('/api/jobs?query=thermal&limit=10');assert.equal(r.value.items.length,10);return r;});
    await measure(n,'MCP search / role filter',async i=>{const r=await http('/mcp',{jsonrpc:'2.0',id:i,method:'tools/call',params:{name:'search_jobs',arguments:{query:'thermal',limit:10}}});assert.equal(r.value.result.structuredContent.items.length,10);return r;});
    await measure(n,'Duplicate preview',()=>{const r=callTool(service,'owner','check_duplicate',{company:'Synthetic c0',posting:{round_key:'r0',role_code:'thermal',title:'Synthetic position 0'}});assert.equal(r.decision,'merge');});
    await measure(n,'Rule evaluation (cold)',i=>reviewPosting(service,'owner','p'+(20+i)));
    await measure(n,'Rule evaluation (cached)',()=>reviewPosting(service,'owner','p0'));
    await measure(n,'Schedule creation',i=>service.mutate('owner','schedules',undefined,undefined,{posting_id:'p0',title:'Event '+i,kind:'interview'}));
    await measure(n,'Compare two jobs',()=>{assert.equal(callTool(service,'owner','compare_jobs',{ids:['p0','p1']}).items.length,2);});
    await measure(n,'Batch import (5 schedules)',i=>{
      const r=importBatch(service,'owner',{schemaVersion:1,key:'bulk-'+i,items:Array.from({length:5},(_,j)=>({type:'schedules',ref:'s'+j,data:{posting_id:'p0',kind:'deadline',title:'Fixture '+j}}))});
      assert.ok(r.rows.every(row=>row.ok));
    });
  } finally {if(server) await new Promise(done=>server.close(done));db.close();rmSync(root,{recursive:true,force:true});}
}
const env={node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0].model,stamp:new Date().toISOString(),warmups,repeats};
const output=process.argv[2];
if(output) writeFileSync(output,JSON.stringify({env,results},null,2)+'\n');
console.log(JSON.stringify({env,measurements:results.length}));
