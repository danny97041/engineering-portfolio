export const protocolVersion='2026-07-28';
const previousVersion='2025-11-25';
export function paramsSchema(properties={},required=[]) {
  return {type:'object',properties,required,additionalProperties:false};
}
export function validate(value,schema,path='arguments') {
  const fail=()=>{throw Object.assign(new Error('Invalid '+path),{status:422});};
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try {validate(value,option,path);return;} catch { /* Try the next permitted type. */ }
    }
    fail();
  }
  if (schema.type==='null' && value!==null) fail();
  if (schema.type==='object') {
    if (value===null || typeof value!=='object' || Array.isArray(value)) fail();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value,key)) fail();
    for (const [key,entry] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {},key)) validate(entry,schema.properties[key],path+'.'+key);
      else if (schema.additionalProperties===false) fail();
    }
  }
  if (schema.type==='string' && (typeof value!=='string' || value.length<(schema.minLength??0) || value.length>(schema.maxLength??8192))) fail();
  if (schema.type==='integer' && (!Number.isSafeInteger(value) || value<(schema.minimum??0) || value>(schema.maximum??Number.MAX_SAFE_INTEGER))) fail();
  if (schema.type==='boolean' && typeof value!=='boolean') fail();
  if (schema.type==='array') {
    if (!Array.isArray(value) || value.length<(schema.minItems??0) || value.length>(schema.maxItems??50)) fail();
    value.forEach((entry,index)=>validate(entry,schema.items,path+'['+index+']'));
  }
  if (schema.const!==undefined && value!==schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
}
export function definition(name,description,inputSchema,write=false) {
  return {name,description,inputSchema,outputSchema:{type:'object'},annotations:{
    readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false
  }};
}
export function failure(status,message) { return Object.assign(new Error(message),{status}); }
export async function dispatch(message,{list,call,resource,name='careerops'}) {
  const id=message?.id;
  const error=(code,text)=>({jsonrpc:'2.0',id:typeof id==='string'||Number.isSafeInteger(id)?id:null,error:{code,message:text}});
  if (!message || message.jsonrpc!=='2.0' || typeof message.method!=='string' || Array.isArray(message)) return error(-32600,'Invalid request');
  if (id===undefined && message.method.startsWith('notifications/')) return null;
  if (typeof id!=='string' && !Number.isSafeInteger(id)) return error(-32600,'Expected request ID');
  const params=message.params ?? {};
  if (params===null || typeof params!=='object' || Array.isArray(params)) return error(-32602,'Expected named parameters');
  let result;
  const serverInfo={name,version:'0.4.0'};
  const capabilities=resource?{tools:{},resources:{}}:{tools:{}};
  switch (message.method) {
    case 'server/discover': result={supportedVersions:[protocolVersion,previousVersion],serverInfo,capabilities};break;
    case 'initialize': result={protocolVersion:params.protocolVersion===protocolVersion?protocolVersion:previousVersion,serverInfo,capabilities};break;
    case 'ping': result={};break;
    case 'tools/list': result={tools:list()};break;
    case 'resources/list':
      if (!resource) return error(-32601,'Resources unavailable');
      result={resources:[resource.info]};break;
    case 'resources/read':
      if (!resource || params.uri!==resource.info.uri) return error(-32002,'Resource not found');
      result={contents:[{uri:resource.info.uri,mimeType:resource.info.mimeType,text:resource.html}]};break;
    case 'tools/call': {
      if (typeof params.name!=='string') return error(-32602,'Expected tool name');
      try {
        const value=await call(params.name,params.arguments ?? {},String(id));
        const text=JSON.stringify(value);
        if (new TextEncoder().encode(text).length>32768) throw failure(413,'Result too large. Narrow the requested range.');
        result={content:[{type:'text',text}],structuredContent:value,isError:false};
      } catch (err) {
        const code=Number.isInteger(err.status)?err.status:500;
        const message=code<500?err.message:'Temporary service failure';
        result={content:[{type:'text',text:JSON.stringify({status:code,message})}],isError:true};
      }
      break;
    }
    default:return error(-32601,'Unknown method');
  }
  return {jsonrpc:'2.0',id,result};
}
