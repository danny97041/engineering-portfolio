import { check } from '../domain/contracts.mjs';
import { records, writeRecord } from '../application/records.mjs';
import { command } from '../application/commands.mjs';
import { exportData, importBatch } from '../application/exchange.mjs';

export async function advanced(service,actor,request,url,json,jsonBody){
  const path=url.pathname,method=request.method;
  const match=/^\/api\/records(?:\/([\w-]+))?$/.exec(path);
  const known=['/api/commands','/api/exchange/preview','/api/exchange/import','/api/exchange/export'];
  if(!match&&!known.includes(path)) return null;
  service.authorize(actor,true);
  if(match){
    const id=match[1];
    if(method==='GET'){
      check([...url.searchParams].every(([k])=>['limit','offset','postingId'].includes(k)),'Unknown query',400);
      const query=url.searchParams;
      return json(200,records(service,actor,{id,postingId:query.get('postingId'),limit:Number(query.get('limit')??30),offset:Number(query.get('offset')??0)}));
    }
    check(!url.search,'Unexpected query',400);
    if(!id&&method==='POST') {
      const {kind,postingId,data}=await jsonBody(request);
      return json(201,writeRecord(service,actor,{kind,postingId,data}));
    }
    check(id&&['PATCH','DELETE'].includes(method),'Method not allowed',405);
    const tag=request.headers.get('if-match');
    check(/^"[1-9]\d*"$/.test(tag??''),'Supply a quoted If-Match version',428);
    return json(200,writeRecord(service,actor,{id,version:Number(tag.slice(1,-1)),data:method==='PATCH'?await jsonBody(request):undefined,remove:method==='DELETE'}));
  }
  if(path==='/api/exchange/export'){
    check(method==='GET','Method not allowed',405);
    check([...url.searchParams].every(([k])=>['mode','after'].includes(k)),'Unknown query',400);
    return json(200,exportData(service,actor,url.searchParams.get('mode')??'handover',Number(url.searchParams.get('after')??0)));
  }
  check(method==='POST'&&!url.search,'Expected POST without query',405);
  const input=await jsonBody(request);
  return json(200,path==='/api/commands'?command(service,actor,input):importBatch(service,actor,input,path.endsWith('/preview')));
}
