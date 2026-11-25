import { dispatch, definition, failure, paramsSchema, validate } from '../../../packages/mcp/protocol.mjs';
const id={type:'string',minLength:1,maxLength:80};
const title={type:'string',minLength:1,maxLength:150};
const common={id,key:id};
const commands=[
  definition('get_test_record','Read one synthetic CareerOps record owned by the signed-in caller.',paramsSchema({id},['id'])),
  definition('add_test_record','Add one synthetic schedule test record. Reuse key for a retry.',paramsSchema({...common,title},['id','key','title']),true),
  definition('update_test_record','Change or archive a synthetic record at the observed version.',paramsSchema({...common,version:{type:'integer',minimum:1},status:{type:'string',enum:['confirmed','archived']}},['id','key','version','status']),true)
];
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if (path==='/' && request.method==='GET') return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><title>CareerOps Demo</title><main><h1>CareerOps Demo</h1><p>비공개 MCP 합성 데이터 시험 환경</p><p>각 사용자는 자신의 시험 레코드를 생성·조회·확정·보관할 수 있습니다.</p></main></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if (path!=='/mcp') return json({error:'Unknown route'},404);
    if (request.method!=='POST') return json({error:'POST required'},405);
    const origin=request.headers.get('origin');
    if (origin && origin!==new URL(request.url).origin) return json({error:'Invalid origin'},403);
    if (request.headers.get('content-type')?.split(';')[0]!=='application/json') return json({error:'Expected JSON'},415);
    if (Number(request.headers.get('content-length') ?? 0)>16384) return json({error:'Request too large'},413);
    const reader=request.body?.getReader();
    if (!reader) return json({error:'Empty body'},400);
    const chunks=[];let size=0;
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>16384) {await reader.cancel();return json({error:'Request too large'},413);}
      chunks.push(value);
    }
    let message;
    try { message=JSON.parse(await new Blob(chunks).text()); } catch { return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}},400); }
    const principal=request.headers.get('oai-authenticated-user-id');
    // Platform can discover a private Site's tools before a visitor connects.
    if (message?.method==='tools/call' && !principal) return json({error:'Signed-in Site identity required'},401);
    const result=await dispatch(message,{list:()=>commands,name:'careerops-demo',call:async(name,args)=>{
      const tool=commands.find(item=>item.name===name);
      if (!tool) throw failure(404,'Unknown tool');
      validate(args,tool.inputSchema);
      const get=()=>env.DB.prepare('SELECT id,title,status,version FROM qa_records WHERE principal=? AND id=?').bind(principal,args.id).first();
      if(name==='get_test_record') {
        const row=await get();
        if (!row) throw failure(404,'Record not found');
        return row;
      }
      const create=name==='add_test_record';
      const payload=JSON.stringify(create?{op:'create',id:args.id,title:args.title}:{op:'update',id:args.id,status:args.status,version:args.version});
      try {
        await env.DB.prepare('INSERT INTO qa_commands VALUES (?,?,?) ON CONFLICT(principal,request_key) DO NOTHING').bind(principal,args.key,payload).run();
      } catch(error) {
        if (String(error.message).includes('conflict')) throw failure(409,'Record or version conflict');
        throw error;
      }
      const receipt=await env.DB.prepare('SELECT payload FROM qa_commands WHERE principal=? AND request_key=?').bind(principal,args.key).first();
      if (receipt?.payload!==payload) throw failure(409,'Key reused with different arguments');
      return {id:args.id,status:create?'planned':args.status,version:create?1:args.version+1};
    }});
    return result===null?new Response(null,{status:202}):json(result);
  }
};
