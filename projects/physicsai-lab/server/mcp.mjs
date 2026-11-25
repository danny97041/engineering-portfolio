import {bounded} from '../web/package.mjs';
import {compare} from '../web/search.mjs';

const protocolVersion='2026-07-28';
const textId={type:'string',minLength:1,maxLength:120};
const limit={type:'integer',minimum:1,maximum:25};
const offset={type:'integer',minimum:0,maximum:2000};
const tool=(name,description,properties={},required=[])=>({
  name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
});
const definitions=[
  tool('list_pdes','List PDE domains, outputs and boundary conditions'),
  tool('list_experiments','List experiment metrics with optional PDE, method or seed filter',
    {equation:textId,arm:textId,seed:{type:'integer',minimum:0},offset,limit}),
  tool('compare_pinn_methods','Compare stored L2 by method and evaluation set',{equation:textId},['equation']),
  tool('get_experiment_metrics','Read metrics with experiment ID and evaluation provenance',{id:textId},['id']),
  tool('get_model_info','Read stored model metadata and browser capability',{id:textId},['id']),
  tool('get_field_data','Get one derived saved grid frame, downsampled with endpoints preserved',
    {id:textId,frame:{type:'integer',minimum:0,maximum:2},stride:{type:'integer',minimum:1,maximum:4}},['id']),
  tool('search_research_documents','Retrieve source-linked BM25 evidence',{query:{type:'string',minLength:1,maxLength:512},limit}),
  tool('get_validation_results','Read browser conversion validation for one experiment',{id:textId},['id']),
  tool('generate_technical_summary','Summarize recorded metrics and validation evidence',{id:textId},['id']),
  tool('get_release_info','Return pinned release and experiment counts'),
  tool('get_experiment_lineage','Read checkpoint and parent references',{id:textId},['id']),
  tool('list_model_versions','List available model records for one PDE',{equation:textId,offset,limit},['equation'])
];
function checkedArgs(value,schema){
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Provide an arguments object');
  if (schema.required.some(key=>!Object.hasOwn(value,key))) throw Error('Required arguments missing');
  for (const [key,arg] of Object.entries(value)) {
    if (!Object.hasOwn(schema.properties,key)) throw Error('Unexpected argument');
    const p=schema.properties[key];
    if (p.type==='string' ? typeof arg!=='string'||!arg.trim()||arg.length>p.maxLength
      : !Number.isSafeInteger(arg)||arg<p.minimum||arg>(p.maximum??Number.MAX_SAFE_INTEGER)) throw Error('Argument out of range');
  }
  return value;
}
const metrics=r=>({id:r.id,equation:r.equation,arm:r.arm,seed:r.seed,version:r.version,field_l2:r.field_l2,
  lambda_error:r.lambda_error,adam_iteration:r.adam_iteration,evaluation:r.field_points,source:r.file});
function models(r,report){
  return {id:r.id,version:r.version,architecture:r.kind,layers:r.layerWidths,source:r.file,
    source_sha256:r.release_metadata?.source_checkpoint_sha256??r.sourceSha256,converted_sha256:r.sha256,
    browser_verified:report.models[r.id]?.verified===true,
    prediction:report.models[r.id]?.verified?'browser_local_model':'results_only'};
}
function paged(rows,{offset=0,limit=10},project){
  return {total:rows.length,items:rows.slice(offset,offset+limit).map(project),
    next_offset:offset+limit<rows.length?offset+limit:null};
}
async function run(name,args,catalog,load){
  const {equation,id}=args;
  if (equation && !Object.hasOwn(catalog.pdes,equation)) throw Error('Unknown PDE');
  const rows=catalog.runs.filter(r=>r.publication_status!=='quarantined' && r.publication_status!=='staged');
  const find=()=>{const r=rows.find(row=>row.id===id);if(!r)throw Error('Unknown experiment');return r;};
  switch(name){
  case 'list_pdes':return {release:catalog.release,items:Object.entries(catalog.pdes).map(([id,p])=>({id,domain:p.domain,outputs:p.outputs,boundary:p.boundary,time_axis:p.time_axis}))};
  case 'list_experiments':return paged(rows.filter(r=>(!equation||r.equation===equation)&&(!args.arm||r.arm===args.arm)&&(args.seed===undefined||r.seed===args.seed)),args,metrics);
  case 'compare_pinn_methods':return {equation,groups:compare(rows,equation)};
  case 'get_release_info':return {release:catalog.release,source_commit:catalog.source,pdes:Object.keys(catalog.pdes).length,experiments:rows.length,registry_revision:catalog.revision};
  case 'get_experiment_metrics':return metrics(find());
  case 'get_experiment_lineage':{
    const r=find(), meta=r.release_metadata;
    return {id,version:r.version,source:r.file,source_commit:meta?.source_commit??catalog.source,
      source_sha256:meta?.source_checkpoint_sha256??r.sourceSha256,package_id:meta?.package_id??null,parent_experiment_id:meta?.parent_experiment_id??null};
  }
  case 'get_model_info':return models(find(),await load.validation());
  case 'list_model_versions':{
    const report=await load.validation();
    return paged(rows.filter(r=>r.equation===equation),args,r=>models(r,report));
  }
  case 'get_validation_results':{
    find();
    const report=await load.validation();
    return {id,parity:report.parity,validation:report.models[id]??null};
  }
  case 'get_field_data':{
    const r=find(),grid=await load.field(r.id);
    if (!grid) throw Error('Saved grid unavailable');
    const frame=args.frame??0,stride=args.stride??2;
    if (!grid.frames[frame]) throw Error('Frame out of range');
    const coords=Array.from({length:grid.n},(_,i)=>i).filter(i=>i%stride===0||i===grid.n-1);
    const p=catalog.pdes[r.equation];
    return {id,release:r.version,origin:grid.origin,domain:p.domain,outputs:p.outputs,time_fraction:grid.times[frame],indices:coords,
      original_size:grid.n,values:coords.map(y=>coords.map(x=>grid.frames[frame][y*grid.n+x]))};
  }
  case 'search_research_documents':{
    const idx=load.index({...catalog,runs:rows}),k=Math.min(args.limit??5,10);
    return {backend:'BM25',index_version:idx.version,stale:idx.stale,results:idx.search(args.query,k).map(row=>({...row,text:row.text.slice(0,700)}))};
  }
  case 'generate_technical_summary':{
    const r=find(),v=(await load.validation()).models[id];
    return {summary:r.equation+' '+r.arm+' seed '+r.seed+' recorded field relative L2 '+r.field_l2+
      ' on '+r.field_points+'. Browser conversion status: '+(v?.verified?'verified at the recorded probe points.':'pending.'),
      evidence:metrics(r),parity_max_absolute_difference:v?.maximum??null};
  }
  }
}
export async function mcp(request,owner,respond,load){
  const reply=(id,result)=>respond({jsonrpc:'2.0',id,result});
  const problem=(id,code,message,status=200)=>respond({jsonrpc:'2.0',id,error:{code,message}},status);
  let message;
  if(request.method!=='POST')return problem(null,-32600,'Use POST',405);
  try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request.body,16384)));}
  catch{return problem(null,-32700,'Malformed or oversized JSON',400);}
  if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'||
    (message.id!==undefined&&typeof message.id!=='string'&&!Number.isSafeInteger(message.id)))
    return problem(null,-32600,'Invalid request',400);
  const {id,method,params}=message;
  if(id===undefined)return new Response(null,{status:202});
  if(method==='server/discover')return reply(id,{supportedVersions:[protocolVersion],capabilities:{tools:{}}});
  if(method==='initialize')return reply(id,{protocolVersion:params?.protocolVersion==='2025-11-25'?'2025-11-25':protocolVersion,
    capabilities:{tools:{}},serverInfo:{name:'physicsai-lab',version:'1.0.0'}});
  if(method==='ping')return reply(id,{});
  if(method==='tools/list')return reply(id,{tools:definitions});
  if(method!=='tools/call')return problem(id,-32601,'Unknown method');
  if(!owner)return problem(id,-32600,'Site owner identity required',403);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return problem(id,-32600,'Origin not permitted',403);
  const definition=definitions.find(item=>item.name===params?.name);
  if(!definition)return problem(id,-32602,'Unknown read-only tool');
  const audit=(outcome)=>console.info(JSON.stringify({event:'physicsai_mcp_tool',tool:definition.name,outcome}));
  try{
    const args=checkedArgs(params.arguments===undefined?{}:params.arguments,definition.inputSchema);
    const result=await run(definition.name,args,await load.catalog(),load);
    const output=JSON.stringify(result);
    if(new TextEncoder().encode(output).byteLength>49152) throw Error('Response exceeds limit');
    audit('ok');
    return reply(id,{content:[{type:'text',text:output}],structuredContent:result});
  }catch(e){
    audit('error');
    // Emit only bounded, intentional validation messages. Provider details stay server-side.
    const messages=['Provide an arguments object','Required arguments missing','Unexpected argument','Argument out of range',
      'Unknown PDE','Unknown experiment','Saved grid unavailable','Frame out of range','Invalid query','Response exceeds limit'];
    return reply(id,{isError:true,content:[{type:'text',text:messages.includes(e.message)?e.message:'Research data unavailable'}]});
  }
}
