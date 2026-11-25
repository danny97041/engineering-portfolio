import initSql from 'sql.js/dist/sql-asm.js';
import { SqlStore } from './sqlite.mjs';
import { CareerService } from '../../../packages/application/service.mjs';
import { createHandler } from '../../../packages/api/http.mjs';
import { listTools } from '../../../packages/mcp/gateway.mjs';
import { dispatch } from '../../../packages/mcp/protocol.mjs';
import { viewResource,viewHtml,withView } from '../../../packages/mcp/view.mjs';
import qa from '../sandbox/worker.mjs';
import { assets,baseline,realm,stage } from 'deployment-data';

const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const toBytes=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
const transform=async(bytes,stream)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
let engine;
const budgets=new Map();
function withinBudget(key,limit,now=Date.now()){
  const minute=Math.floor(now/60000);
  for(const [k,v] of budgets) if(v.minute!==minute) budgets.delete(k);
  const bucket=budgets.get(key)??{minute,count:0};
  if(bucket.count>=limit) return false;
  bucket.count++;budgets.set(key,bucket);return true;
}
async function rawStore(bytes){
  engine??=initSql();
  return new (await engine).Database(await transform(bytes,new DecompressionStream('gzip')));
}
async function readBody(request){
  const reader=request.body?.getReader();
  if(!reader) return '';
  let length=0;const chunks=[];
  while(true){
    const {value,done}=await reader.read();if(done) break;
    length+=value.byteLength;
    if(length>16384){await reader.cancel();throw Object.assign(Error('Request too large'),{status:413});}
    chunks.push(value);
  }
  return new Blob(chunks).text();
}
async function persist(db,principal,prior,snapshot){
  if(snapshot.length>1800000) throw Object.assign(Error('Workspace snapshot limit exceeded'),{status:413});
  try {
    await db.prepare('INSERT INTO workspace_revisions VALUES (?,?,?,?,?)').bind(principal,prior+1,prior,new Date().toISOString(),snapshot).run();
  } catch(error) {
    if(/unique|constraint/i.test(error.message)) throw Object.assign(Error('Workspace changed. Refresh and retry.'),{status:409});
    throw error;
  }
}
async function verify(request,env){
  const principal='probe:'+crypto.randomUUID();
  const call=async(path,method='GET',body)=>{
    const headers={'content-type':'application/json'};
    const req=new Request(new URL(path,request.url),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const response=await handle(req,env,principal);
    if(!response.ok) throw Object.assign(Error('Verification '+path+' '+(await response.text()).slice(0,220)),{status:503});
    return response.json();
  };
  try {
    const before=await call('/api/exchange/export?mode=handover');
    const created=await call('/api/v1/companies','POST',{name:'Synthetic release probe'});
    const reopened=await call('/api/v1/companies/'+created.id);
    if(reopened.id!==created.id) throw Error('Persistence check failed');
    const args={schemaVersion:1,key:'release-transfer',items:[
      {ref:'job',type:'job_postings',data:{company_id:created.id,title:'Synthetic transfer probe',round_key:'probe',role_code:'probe'}},
      {ref:'app',type:'applications',data:{posting_id:{$ref:'job'},stage:'rejected',history:{source:'Synthetic migration proof',submittedOn:'2025-01-02'}}}]};
    const rpc=async name=>{
      const msg=await call('/mcp','POST',{jsonrpc:'2.0',id:'release-'+name,method:'tools/call',params:{name,arguments:args}});
      if(msg.result?.isError||!msg.result?.structuredContent?.rows?.every(r=>r.ok)) throw Error('Work batch verification failed');
      return msg.result.structuredContent;
    };
    await rpc('preview_work_batch');
    const applied=await rpc('apply_work_batch'),replayed=await rpc('apply_work_batch');
    const imported=await call('/api/v1/applications/'+applied.rows[1].id);
    if(imported.submitted_at!=='2025-01-02'||replayed.rows[1].id!==imported.id) throw Error('Historical import verification failed');
    const state=await call('/api/recovery');
    const recovered=await call('/api/recovery','POST',{expected:state.revision,restore:0});
    const after=await call('/api/v1/companies');
    if(after.some(r=>r.id===created.id)) throw Error('Restore check failed');
    return json({realm,stage,stored:true,reopened:true,workBatch:true,historicalDate:true,restored:recovered.restored===0,baselinePostings:before.metrics.candidates});
  } finally {await env.DB.prepare('DELETE FROM workspace_revisions WHERE principal=?').bind(principal).run();}
}
async function handle(request,env,probePrincipal){
  try {
    const url=new URL(request.url),path=url.pathname;
    const identity=request.headers.get('oai-authenticated-user-id');
    if(request.method!=='GET' && request.headers.has('origin') && request.headers.get('origin')!==url.origin) return json({error:'Invalid origin'},403);
    if(path==='/api/verification' && request.method==='POST' && !probePrincipal){
      if(!withinBudget('verification',4)) return json({error:'Try again next minute'},429);
      return await verify(request,env);
    }
    const probe=path==='/api/health';
    // The platform verifies private Site access before routing service health probes.
    if(probe && request.method==='GET'){
      const healthy=await env.DB.prepare('SELECT count(*) n FROM workspace_revisions WHERE 0').first();
      return json({healthy:healthy.n===0,realm,stage});
    }
    if(path==='/mcp' && request.method!=='POST') return json({error:'Expected POST'},405);
    if(!['GET','POST','PATCH','PUT','DELETE'].includes(request.method)) return json({error:'Method not allowed'},405);
    if(identity && !probePrincipal && (path.startsWith('/api/')||path==='/mcp') && !withinBudget('user:'+identity,180))
      return json({error:'Try again next minute'},429);
    const body=request.method==='GET'?'':await readBody(request);
    let message;
    if(path==='/mcp'){
      try {message=JSON.parse(body);} catch {return json({error:'Invalid JSON'},400);}
      if(message?.method==='tools/list'||message?.method==='initialize'||message?.method==='server/discover'){
        let list=listTools('owner').map(withView);
        if(realm==='demo' && message.method==='tools/list'){
          const response=await qa.fetch(new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body}),env);
          list=list.concat((await response.json()).result.tools);
        }
        return json(await dispatch(message,{list:()=>list,resource:{info:viewResource,html:viewHtml},name:'careerops-'+realm}));
      }
    }
    if(!identity && !probePrincipal) return json({error:'Sign in to this private Site'},401);
    if(realm==='demo'&&path==='/mcp'&&['get_test_record','add_test_record','update_test_record'].includes(message?.params?.name))
      return qa.fetch(new Request(request.url,{method:'POST',headers:request.headers,body}),env);
    if(request.method==='GET' && Object.hasOwn(assets,path)){
      const [mime,content]=assets[path];
      return new Response(content,{headers:{'content-type':mime+'; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"}});
    }
    if(!path.startsWith('/api/')&&path!=='/mcp') return json({error:'Unknown route'},404);
    const principal=probePrincipal??('user:'+identity);
    const row=await env.DB.prepare('SELECT revision,snapshot FROM workspace_revisions WHERE principal=? ORDER BY revision DESC LIMIT 1').bind(principal).first();
    const revision=row?.revision??0;
    const compressed=row?new Uint8Array(row.snapshot):toBytes(baseline);
    if(path==='/api/recovery/download' && request.method==='GET'){
      const sqlite=await transform(compressed,new DecompressionStream('gzip'));
      return new Response(sqlite,{headers:{'content-type':'application/vnd.sqlite3','cache-control':'no-store',
        'content-disposition':'attachment; filename="careerops-'+realm+'-r'+revision+'.sqlite"'}});
    }
    if(path==='/api/recovery'){
      if(request.method==='GET'){
        const versions=await env.DB.prepare('SELECT revision,saved FROM workspace_revisions WHERE principal=? ORDER BY revision DESC LIMIT 100').bind(principal).all();
        return json({realm,revision,versions:versions.results});
      }
      if(request.method!=='POST') return json({error:'Expected POST'},405);
      const input=JSON.parse(body);
      if(input.expected!==revision) return json({error:'Stale revision'},409);
      if(!Number.isSafeInteger(input.restore)||input.restore<0||input.restore>=revision) return json({error:'Choose an earlier revision'},422);
      const previous=input.restore===0?{snapshot:toBytes(baseline)}:await env.DB.prepare('SELECT snapshot FROM workspace_revisions WHERE principal=? AND revision=?').bind(principal,input.restore).first();
      if(!previous) return json({error:'Unknown revision'},404);
      const restored=await rawStore(new Uint8Array(previous.snapshot));
      try {
        const db=new SqlStore(restored);
        const binding=db.prepare('SELECT realm,stage FROM instance_binding').get();
        if(binding.realm!==realm||binding.stage!==stage||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get()) return json({error:'Snapshot verification failed'},409);
      } finally {restored.close();}
      await persist(env.DB,principal,revision,new Uint8Array(previous.snapshot));
      return json({restored:input.restore,revision:revision+1});
    }
    const raw=await rawStore(compressed);
    try {
      const db=new SqlStore(raw),service=new CareerService(db);
      if(service.binding.realm!==realm||service.binding.stage!==stage) return json({error:'Binding mismatch'},503);
      const reset=realm==='demo'?()=>({reset:true}):undefined;
      const key=realm+'.'+stage+'.'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,11);
      const headers=new Headers(request.headers);headers.set('authorization','Bearer '+key);
      const handler=createHandler(service,realm,stage,key,undefined,reset);
      const response=await handler(new Request(url,{method:request.method,headers,body:request.method==='GET'?undefined:body}));
      const resetting=path==='/api/sandbox'&&request.method==='POST'&&response.ok;
      if(resetting||db.dirty){
        const next=resetting?toBytes(baseline):await transform(raw.export(),new CompressionStream('gzip'));
        await persist(env.DB,principal,revision,next);
      }
      return response;
    } finally {raw.close();}
  } catch(error) {return json({error:probePrincipal?String(error.message).slice(0,160):error.status?error.message:'Workspace operation failed'},error.status??500);}
}
export default {fetch:(request,env)=>handle(request,env)};
