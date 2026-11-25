import { button, download, h, select, table } from './dom.mjs';
import { openPanel } from './forms.mjs';
import { csv, markdown, ics } from './exports.mjs';

const json=value=>JSON.stringify(value,null,2);
export function chatSettingsPanel({api,t,safe,report}){
  const path='/api/personalization/chat';
  const status=h('p',{role:'status'});
  const link=h('a',{href:'https://chatgpt.com/',target:'_blank',rel:'noopener noreferrer'},t('ChatGPT 열기','Open ChatGPT'));
  const input=h('input',{type:'url',maxlength:400,placeholder:'https://chatgpt.com/c/…'});
  const save=h('button',{type:'submit',disabled:true},t('대화 링크 저장','Save conversation link'));
  const clear=button(t('링크 삭제','Remove link'),()=>update(null),{disabled:true});
  let version;
  function show(result){
    version=result.version;
    input.value=result.conversationUrl??'';
    link.href=result.conversationUrl??'https://chatgpt.com/';
    link.textContent=result.conversationUrl?t('연결된 GPT 대화 열기','Open linked GPT conversation'):t('ChatGPT 열기','Open ChatGPT');
    clear.disabled=!result.conversationUrl;
    save.disabled=false;
  }
  function update(value){
    safe(async()=>{
      save.disabled=true;clear.disabled=true;
      try{
        show(await api(path,'PUT',{conversationUrl:value},version));
        report(t('대화 링크를 저장했습니다.','Conversation link saved.'));
      } catch(error){
        save.disabled=false;clear.disabled=!input.value;
        throw error;
      }
    });
  }
  safe(async()=>{
    try {show(await api(path));} catch(error){status.textContent=error.message;}
  });
  return h('section',{class:'card stack'},h('h2',{},t('GPT 대화 연결','GPT conversation')),
    h('p',{},t('브라우저 주소창에서 비공개 대화 주소를 복사해 저장하세요. 대화 안에서 CareerOps 앱을 선택하면 권한이 허용된 업무 자료를 조회할 수 있습니다.',
      'Save the private conversation address from your browser. In ChatGPT, select the CareerOps app to access workspace tools permitted for your account.')),
    h('form',{class:'stack',onsubmit:event=>{event.preventDefault();update(input.value.trim()||null);}},
      h('label',{},t('비공개 GPT 대화 주소','Private GPT conversation URL'),input),
      h('div',{class:'actions'},save,clear,link)),status,
    h('h3',{},t('Work에서 연결','Connect in Work')),
    h('p',{},t('ChatGPT를 열어 Work를 선택한 뒤, 도구 선택기에서 현재 작업공간과 일치하는 CareerOps 앱을 연결하세요. 미분석 공고에서 복사한 요청을 새 Work 작업에 붙여 넣을 수 있습니다.',
      'Open ChatGPT, switch to Work and connect the CareerOps app that matches your workspace. Paste a request copied from an unreviewed posting into a new Work task.')),
    h('a',{href:'https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex',target:'_blank',rel:'noopener noreferrer'},
      t('Work 전환 위치 안내','Where to switch to Work')));
}
export function playgroundPanel({api,t,safe,load,data}){
  const output=h('pre',{role:'status'});
  const input=h('textarea',{rows:10,value:'{}','aria-label':t('도구 입력 JSON','Tool arguments JSON')});
  const picker=select([['get_dashboard','get_dashboard']],'get_dashboard');
  const mcp=async(method,params)=>api('/mcp','POST',{jsonrpc:'2.0',id:crypto.randomUUID(),method,params});
  const run=()=>safe(async()=>{
    const response=await mcp('tools/call',{name:picker.value,arguments:JSON.parse(input.value)});
    output.textContent=json(response);
  });
  safe(async()=>{
    const response=await mcp('tools/list',{});
    picker.replaceChildren(...response.result.tools.map(tool=>h('option',{value:tool.name},tool.name)));
    picker.value='get_dashboard';
  });
  const sample=()=>{
    const company=data.companies[0];
    if(!company) return;
    picker.value='record_scan_run';
    const key=crypto.randomUUID();
    input.value=json({key,items:[{company:company.name,source:'https://example.invalid/playground/'+key,
      evidence:'Synthetic scan fixture',observedAt:new Date().toISOString(),posting:{round_key:'playground-'+key,role_code:'thermal',title:'합성 열유동 공고'}}]});
  };
  return h('section',{class:'stack'},
    h('p',{},t('이 세션의 합성 데이터에 실제 로컬 MCP를 호출합니다. 스캔 예제는 합성 입력을 사용합니다.','Calls use the real local MCP gateway for this synthetic session. The scan sample supplies simulated input.')),
    h('label',{},t('도구 선택','Tool'),picker),input,
    h('div',{class:'actions'},button(t('합성 스캔 예제','Synthetic scan example'),sample),button(t('도구 실행','Run tool'),run),
      button(t('초기 데이터로 복원','Reset to seed'),()=>safe(async()=>{
        if(!window.confirm(t('이 데모 세션을 초기화할까요?','Reset this demo session?'))) return;
        await api('/api/sandbox','POST',{});await load();
      }))),output);
}
export function commandsPanel({api,t,safe,load}){
  const input=h('input',{'aria-label':t('명령','Command'),placeholder:'일정표'});
  const result=h('div',{role:'status'});
  const run=()=>safe(async()=>{
    const text=input.value;
    const data=await api('/api/commands','POST',{text});
    if(data.confirmationRequired){
      const {postingId,postingVersion,applicationVersion,company,round,role,changes}=data.proposed;
      const key=crypto.randomUUID();
      const confirm=button(t('변경 확정','Confirm change'),()=>safe(async()=>{
        confirm.disabled=true;
        try {
          const saved=await api('/api/commands','POST',{text,confirmation:{postingId,postingVersion,applicationVersion,key}});
          result.replaceChildren(h('pre',{},json(saved)));
          await load(false);
        } finally {confirm.disabled=false;}
      }));
      result.replaceChildren(h('p',{},[company,round,role].join(' / ')),h('pre',{},json(changes)),confirm);
    } else if(text.trim()==='일정표'){
      result.replaceChildren(table(['날짜','시간','유형','제목','장소·비고'],data.items.map(r=>[r.start_date,r.start_time??'—',r.kind,r.title,[r.location,r.notes].filter(Boolean).join(' · ')]),'일정표','일정 없음'));
    } else result.replaceChildren(h('pre',{},json(data)));
  });
  return h('section',{class:'stack'},
    h('form',{onsubmit:e=>{e.preventDefault();run();}},input,h('button',{type:'submit'},t('실행','Run'))),
    h('div',{class:'actions'},['일정표','이번 주 일정','발표일만','다음 면접','마감 임박','지원현황','미분석 목록'].map(cmd=>button(cmd,()=>{input.value=cmd;run();}))),result);
}
const templates={
  interview:{title:'',venue:'',format:'',expectedQuestions:'',concepts:'',draftAnswers:'',actualQuestions:'',actualAnswers:'',feedback:'',weaknesses:'',improvements:'',chatUrl:'',studyIds:[],completed:false},
  document:{title:'',category:'resume',revision:1,submittedOn:'',referenceUrl:'',notes:''},
  study:{title:'',topic:'',notes:'',referenceUrl:'',completed:false}
};
export function recordsPanel({api,t,safe,data}){
  const output=h('div',{role:'status'});
  let offset=0;
  const labels={interview:t('면접','Interview'),document:t('문서','Document'),study:t('공통 학습 자료','Shared study')};
  async function refresh(){
    const response=await api('/api/records?offset='+offset);
    output.replaceChildren(table([t('종류','Kind'),t('제목','Title'),t('공고','Posting'),t('버전','Version')],
      response.items.map(row=>[labels[row.kind],button(row.data.title,()=>edit(row.kind,row)),data.postings.find(p=>p.id===row.posting_id)?.title??'—',row.version]),t('면접·문서','Records'),t('기록 없음','No records')),
      offset?button(t('이전','Previous'),()=>safe(async()=>{offset=Math.max(0,offset-30);await refresh();})):null,
      response.nextOffset!==null?button(t('다음','Next'),()=>safe(async()=>{offset=response.nextOffset;await refresh();})):null);
  }
  function edit(kind,row){
    const details={...templates[kind],...row?.data};
    const title=h('input',{value:details.title,required:true});
    const linked=select([['',t('공고 선택','Choose posting')],...data.postings.map(p=>[p.id,p.title+' · '+p.round_key])],row?.posting_id??'');
    delete details.title;
    const entry=h('textarea',{rows:14,'aria-label':t('세부 정보 JSON','Details JSON'),value:json(details)});
    const form=h('form',{class:'stack',onsubmit:e=>{
      e.preventDefault();
      safe(async()=>{
        const attributes=JSON.parse(entry.value);
        const values=Object.fromEntries(Object.entries({...attributes,title:title.value}).filter(([,v])=>v!==''));
        if(row) await api('/api/records/'+row.id,'PATCH',values,row.version);
        else await api('/api/records','POST',{kind,postingId:linked.value||undefined,data:values});
        form.closest('dialog')?.close();
        await refresh();
      });
    }},h('label',{},t('제목','Title'),title),row||kind==='study'?null:linked,
    h('label',{},t('세부 정보 JSON','Details JSON'),entry),h('button',{type:'submit'},t('저장','Save')),
    row?button(t('삭제','Delete'),()=>safe(async()=>{
      if(!window.confirm(t('이 기록을 삭제할까요?','Delete this record?'))) return;
      await api('/api/records/'+row.id,'DELETE',undefined,row.version);
      form.closest('dialog')?.close();await refresh();
    })):null);
    openPanel(labels[kind],t,form);
  }
  safe(refresh);
  return h('section',{class:'stack'},h('div',{class:'actions'},Object.entries(labels).map(([kind,label])=>button(label+' +',()=>edit(kind)))),output);
}
export function exchangePanel({api,t,safe,load}){
  const input=h('textarea',{rows:10,'aria-label':t('가져오기 JSON','Import JSON'),placeholder:'{"schemaVersion":1,"key":"batch-01","items":[]}'});
  const status=h('pre',{role:'status'});
  const execute=mode=>safe(async()=>{
    status.textContent=json(await api('/api/exchange/'+mode,'POST',JSON.parse(input.value)));
    if(mode==='import') await load(false);
  });
  const save=(mode,format)=>safe(async()=>{
    const suffix=mode==='changes'?'&after='+cursor.value:'';
    const payload=await api('/api/exchange/export?mode='+mode+suffix);
    if(format==='json') return download('careerops-'+mode+'.json',json(payload),'application/json');
    if(format==='ics') return download('careerops-schedule.ics',ics(payload.schedules),'text/calendar');
    const blocks=[
      ['일정표',['날짜','제목','유형'],payload.schedules.map(r=>[r.start_date,r.title,r.kind])],
      ['지원현황',['공고 ID','지원 의사','전형'],payload.applications.map(r=>[r.posting_id,r.intent,r.stage])],
      ['미분석 목록',['회차','공고','직무'],payload.unreviewed.map(r=>[r.round_key,r.title,r.role_code])]
    ];
    if(format==='csv'){
      download('careerops-handover.csv',csv(['구분','값 1','값 2','값 3'],blocks.flatMap(([section,,rows])=>rows.map(row=>[section,...row]))),'text/csv');
      return;
    }
    const handover='# CareerOps · '+payload.today+'\n\n'+blocks.map(([title,headers,rows])=>'## '+title+'\n\n'+markdown(headers,rows)).join('\n\n');
    if(format==='copy') {await navigator.clipboard.writeText(handover);status.textContent=t('복사했습니다.','Copied.');}
    else download('careerops-handover.md',handover,'text/markdown');
  });
  const cursor=h('input',{type:'number',min:0,value:0,'aria-label':t('변경 시작 번호','Change cursor')});
  return h('section',{class:'stack'},input,h('div',{class:'actions'},button(t('드라이런','Preview'),()=>execute('preview')),button(t('가져오기','Import'),()=>execute('import'))),status,
    h('div',{class:'actions'},button(t('전체 JSON','Full JSON'),()=>save('full','json')),cursor,button(t('변경분 JSON','Changes JSON'),()=>save('changes','json')),
      ...['md','csv','ics','copy'].map(f=>button(f==='copy'?t('인수인계 복사','Copy handover'):f.toUpperCase(),()=>save('handover',f)))));
}
