import { button, download, h, select, table } from './dom.mjs';
import { openPanel } from './forms.mjs';
import { csv, markdown, ics } from './exports.mjs';

const json=value=>JSON.stringify(value,null,2);
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
          await load();
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
    if(mode==='import') await load();
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
