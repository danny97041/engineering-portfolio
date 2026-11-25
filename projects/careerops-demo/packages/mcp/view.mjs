export const viewResource={uri:'ui://careerops/workspace',name:'CareerOps workspace',mimeType:'text/html;profile=mcp-app'};
export const viewTools=new Set(['get_schedule','get_job_details','compare_jobs']);
export function withView(tool) {
  if (!viewTools.has(tool.name)) return tool;
  const meta={ui:{resourceUri:viewResource.uri}};
  if (tool.name==='get_schedule') meta['openai/ui']={entrypoints:[{type:'global'}]};
  return {...tool,title:tool.name==='get_schedule'?'CareerOps 일정표':tool.name,_meta:meta};
}
export const viewHtml=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CareerOps</title><style>body{font:1rem system-ui;margin:1rem;color:CanvasText;background:Canvas}article{padding:.75rem 0;border-bottom:1px solid GrayText}h2{font-size:1rem}p{margin:.3rem 0}input,button{font:inherit;margin:.25rem}</style>
<main><h1>CareerOps</h1><p id="notice" role="status">결과를 기다리는 중</p><section id="records"></section></main>
<script type="module">
const notice=document.getElementById('notice'), records=document.getElementById('records');
let host='*', sequence=0;
const pending=new Map();
const post=message=>parent.postMessage({jsonrpc:'2.0',...message},host);
function request(method,params) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error('호스트 응답 시간 초과'));},15000);
    pending.set(id,{resolve,reject,timeout});post({id,method,params});
  });
}
function element(tag,text) {
  const el=document.createElement(tag);el.textContent=text;return el;
}
function render(result) {
  if(result.isError) {notice.textContent=result.content?.[0]?.text??'호출 실패';return;}
  const data=result.structuredContent;
  if (!data) return;
  const rows=data.items??[data];
  records.replaceChildren();
  notice.textContent=rows.length+'건';
  for(const row of rows) {
    const card=element('article','');
    card.append(element('h2',row.title??row.id));
    for(const key of ['round_key','role_code','deadline_date','responsibilities','kind','start_date','start_time','end_date','status','location']) {
      if(row[key]) card.append(element('p',key+' · '+row[key]));
    }
    if(row.kind && row.id && Number.isInteger(row.version)) {
      const label=element('label','일정 제목 '), input=document.createElement('input'), save=element('button','제목 저장');
      input.value=row.title;label.append(input);card.append(label,save);
      let retry=null;
      save.onclick=async()=>{
        if(!input.value.trim()) return;
        const title=input.value.trim();
        if(retry?.data.title!==title) retry={key:crypto.randomUUID(),id:row.id,version:row.version,data:{title}};
        save.disabled=true;
        try {
          const changed=await request('tools/call',{name:'update_schedule',arguments:retry});
          if(changed.isError) throw Error(changed.content?.[0]?.text??'저장 실패');
          const fresh=changed.structuredContent;row.version=fresh.version;row.title=fresh.title;
          card.querySelector('h2').textContent=fresh.title;retry=null;notice.textContent='저장됨 · v'+fresh.version;
        } catch(e) {notice.textContent=e.message;} finally {save.disabled=false;}
      };
    }
    records.append(card);
  }
}
addEventListener('message',event=>{
  if(event.source!==parent || (host!=='*' && event.origin!==host)) return;
  const msg=event.data;
  if(msg?.jsonrpc!=='2.0') return;
  const job=pending.get(msg.id);
  if(job) {
    if(host==='*' && event.origin!=='null') host=event.origin;
    clearTimeout(job.timeout);pending.delete(msg.id);
    if(msg.error) job.reject(Error(msg.error.message));else job.resolve(msg.result);
  } else if(msg.method==='ui/notifications/tool-result') render(msg.params);
});
try {
  await request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'careerops-workspace',version:'0.4.0'},appCapabilities:{}});
  post({method:'ui/notifications/initialized',params:{}});
} catch(e) {notice.textContent=e.message;}
</script></html>`;
