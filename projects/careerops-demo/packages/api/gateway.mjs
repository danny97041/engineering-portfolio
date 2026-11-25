import { ApiError, check } from '../domain/contracts.mjs';
import { listTools, callTool } from '../mcp/gateway.mjs';
import { dispatch } from '../mcp/protocol.mjs';
import { viewResource, viewHtml, withView } from '../mcp/view.mjs';

const routes=[
  ['GET','/api/jobs','search_jobs'],['POST','/api/jobs','add_job','data'],
  ['GET','/api/jobs/:id','get_job_details'],['PATCH','/api/jobs/:id','update_job','data'],
  ['GET','/api/applications','get_applications'],['POST','/api/applications','add_application','data'],
  ['PATCH','/api/applications/:id','update_application_status','data'],
  ['GET','/api/schedules','get_schedule'],['POST','/api/schedules','add_schedule','data'],
  ['PATCH','/api/schedules/:id','update_schedule','data'],
  ['GET','/api/assessments','list_assessments'],['POST','/api/assessments','save_assessment'],
  ['POST','/api/rules/evaluate','evaluate_eligibility'],['POST','/api/duplicates/check','check_duplicate'],
  ['GET','/api/analytics','analytics'],['GET','/api/changes','get_recent_changes'],
  ['GET','/api/automations/runs','get_scan_runs'],['GET','/api/automations/runs/:id','get_scan_runs'],
  ['POST','/api/automations/runs/:id','retry_scan_run'],
  ['POST','/api/automations/runs','record_scan_run'],['POST','/api/import','import_job_batch'],
  ['GET','/api/export','export_handover']
];
export async function gateway(service,actor,request,url,json,jsonBody) {
  const path=url.pathname;
  if (path==='/mcp') {
    check(!url.search,'Unknown query parameter',400);
    check(request.method==='POST','Use POST',405);
    const origin=request.headers.get('origin');
    check(!origin || origin===url.origin || (origin==='http://'+request.headers.get('host') && /^127\.0\.0\.1(:\d+)?$/.test(request.headers.get('host')??'')),'Invalid origin',403);
    const message=await jsonBody(request);
    const result=await dispatch(message,{resource:{info:viewResource,html:viewHtml},list:()=>listTools(actor).map(withView),call:(name,args,id)=>callTool(service,actor,name,args,id)});
    return result===null?new Response(null,{status:202}):json(200,result);
  }
  if (path==='/api/contract') {
    check(request.method==='GET' && !url.search,'Expected GET /api/contract',400);
    const tools=listTools(actor), names=new Set(tools.map(t=>t.name));
    return json(200,{routes:routes.filter(r=>names.has(r[2])),tools,requestBytes:16384,resultBytes:32768});
  }
  if (!path.startsWith('/api/') || path.startsWith('/api/v1/')) return null;
  const segments=path.split('/');
  const matches=routes.filter(([,pattern])=>{
    const parts=pattern.split('/');
    return parts.length===segments.length && parts.every((p,i)=>p===':id'?/^[\w-]{1,128}$/.test(segments[i]):p===segments[i]);
  });
  check(matches.length,'Route not found',404);
  const route=matches.find(([method])=>method===request.method);
  check(route,'Method not allowed',405);
  const [,pattern,name,wrap]=route;
  let args={};
  if (request.method==='GET') {
    for (const [key,value] of url.searchParams) {
      check(['limit','offset','after','query'].includes(key) && !Object.hasOwn(args,key),'Invalid query',400);
      if (key!=='query') check(/^\d+$/.test(value),'Invalid numeric parameter',400);
      args[key]=key==='query'?value:Number(value);
    }
  } else {
    check(!url.search,'Unexpected query',400);
    const body=await jsonBody(request);
    args=wrap?{data:body}:{...body};
    if (listTools('owner').find(t=>t.name===name)?.annotations.readOnlyHint===false) {
      const key=request.headers.get('idempotency-key');
      if (key && args.key && key!==args.key) throw new ApiError(409,'Conflicting request keys');
      args.key=key??args.key;
      check(args.key,'Supply an Idempotency-Key',428);
    }
    if (request.method==='PATCH') {
      const tag=request.headers.get('if-match');
      check(/^"[1-9]\d*"$/.test(tag??''),'Supply a quoted If-Match version',428);
      args.version=Number(tag.slice(1,-1));
    }
  }
  if (pattern.endsWith('/:id')) args.id=segments.at(-1);
  const result=callTool(service,actor,name,args,request.headers.get('x-request-id')??undefined);
  return json(200,result);
}
