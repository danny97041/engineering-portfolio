import {assets} from './embedded.mjs';
import {compile,sha256} from '../web/model.mjs';
import {bounded,fileLimit} from '../web/package.mjs';
import {registryRecord,inspectManifest} from '../web/registry.mjs';
import {compare} from '../web/search.mjs';
import {createIndexCache} from './index-cache.mjs';
import {mcp} from './mcp.mjs';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"};
const json=(value,status=200)=>Response.json(value,{status,headers});
const fail=(message,status)=>new Response(message,{status,headers});
function asset(path) {
  const entry=assets[path];
  if(!entry) return null;
  const compressed=Uint8Array.from(atob(entry[1]),c=>c.charCodeAt(0));
  return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    {headers:{...headers,'Content-Type':entry[0]}});
}
let baseline,validation;
const evidenceIndex=createIndexCache();
async function catalogState(env){
  baseline??=await asset('/data/catalog.json').json();
  const obj=await env.BUCKET.get('registry/v1.json');
  const state=obj?await obj.json():{runs:[],revision:0};
  return {state,etag:obj?.etag,catalog:{...baseline,revision:state.revision,runs:[...baseline.runs,...state.runs]}};
}
const safeJson=async request=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request.body,8192)));
async function research(query,catalog,env){
  const args=query.arguments;
  if(!args || typeof args!=='object' || Array.isArray(args))throw Error('Invalid tool arguments');
  switch(query.tool){
  case 'search':{
    const idx=evidenceIndex(catalog);
    return {backend:'BM25',indexVersion:idx.version,stale:idx.stale,results:idx.search(args.query,args.k??5)};
  }
  case 'compare':if(!Object.hasOwn(catalog.pdes,args.equation))throw Error('Unknown equation');
    return {equation:args.equation,groups:compare(catalog.runs,args.equation)};
  case 'metrics':{const r=catalog.runs.find(r=>r.id===args.id);if(!r)throw Error('Unknown experiment');
    return {id:r.id,field_l2:r.field_l2,evaluation:r.field_points,version:r.version,source:r.file};}
  case 'predict':{
    if(catalog.distribution==='results-only')throw Error('Verified server weights are unavailable in results-only mode.');
    const r=catalog.runs.find(r=>r.id===args.id);
    validation??=await asset('/data/validation.json').json();
    if(!r || !validation.models[r.id]?.verified)throw Error('Verified model required.');
    if(!Array.isArray(args.points) || args.points.length>64)throw Error('Server tool batch limit is 64.');
    const model=await asset('/data/models/'+r.id+'.json').json();
    return {id:r.id,prediction:compile(model)(args.points),research_only:true};
  }
  default:throw Error('Unknown read-only research tool');
  }
}
async function route(request,env) {
  const url=new URL(request.url),path=url.pathname;
  const signed=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  const owner=Boolean(signed && email && env.LAB_OWNER_EMAIL && email.toLowerCase()===env.LAB_OWNER_EMAIL.toLowerCase());
  if(path==='/mcp')return mcp(request,owner,json,{
    catalog:async()=> (await catalogState(env)).catalog,
    validation:async()=> validation??=await asset('/data/validation.json').json(),
    field:async id=>asset('/data/fields/'+id+'.json')?.json(),
    index:evidenceIndex
  });
  if(!owner)return fail('Site owner sign-in required',403);
  const mutating=!['HEAD','GET'].includes(request.method);
  if(mutating && request.headers.get('origin')!==url.origin)return fail('Same-origin request required',403);
  if(path==='/api/session' && !mutating)return json({owner});
  if(path==='/api/health' && !mutating)return json({status:'ok',research_only:true,automatic_promotion:false});
  if(path==='/data/catalog.json' && !mutating)return json((await catalogState(env)).catalog);
  if(path==='/api/research' && request.method==='POST')return json(await research(await safeJson(request),(await catalogState(env)).catalog,env));
  if(path.startsWith('/api/import/')){
    const objectKey=path.match(/^\/api\/import\/artifact\/([0-9a-f]{64})$/);
    if(objectKey && request.method==='PUT'){
      const data=await bounded(request.body,fileLimit);
      if(!data.length || await sha256(data)!==objectKey[1])return fail('Artifact checksum mismatch',422);
      baseline??=await asset('/data/catalog.json').json();
      if(baseline.distribution==='results-only'){
        const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
        if(!doc || typeof doc!=='object' || Array.isArray(doc) || !Object.keys(doc).length || Object.keys(doc).length>64 ||
          !Object.entries(doc).every(([k,v])=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) && Number.isFinite(v)))return fail('Only a flat JSON object of finite metrics is supported here',422);
      }
      const key='quarantine/'+objectKey[1];
      await env.BUCKET.put(key,data,{onlyIf:{etagDoesNotMatch:'*'}});
      return json({stored:true});
    }
    if(request.method!=='POST' || !['/api/import/approve','/api/import/preview'].includes(path))return fail('Unknown operation',404);
    const manifest=await safeJson(request);
    const {etag,state}=await catalogState(env);
    if(baseline.distribution==='results-only' && !manifest.file?.endsWith('.json'))return fail('The hosted catalog accepts metric JSON only',422);
    const result=inspectManifest(manifest,baseline,state.runs);
    if(path.endsWith('preview'))return json(result);
    if(result.status==='conflict')return fail('Immutable run ID conflict',409);
    if(result.status==='duplicate')return json(result);
    if(state.runs.length>=1000)return fail('Registry import quota reached',409);
    if(!await env.BUCKET.head('quarantine/'+manifest.sourceSha256))return fail('Validated artifact required',422);
    const next={revision:state.revision+1,runs:[...state.runs,registryRecord(manifest)]};
    const stored=await env.BUCKET.put('registry/v1.json',JSON.stringify(next),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});
    return stored?json({...result,revision:next.revision},201):fail('Registry changed. Repeat dry run.',409);
  }
  if(!mutating){const resp=asset(path==='/'?'/index.html':path);if(resp)return resp;}
  return fail('Not found',404);
}
export default {async fetch(request,env){
  try{return await route(request,env);}
  catch(e){if(e instanceof SyntaxError || e instanceof RangeError || /Invalid|Unsupported|limit|Unknown|Enter|checksum|fields|coordinates|Verified|empty|Size limit|arguments/i.test(e.message))return fail('Invalid research request',422);
    return fail('Research service unavailable',503);}
}};

