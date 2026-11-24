import { $, button, download, h, ordered, select, table, valueText } from './dom.mjs';
import { applicationFields, companyFields, labelFor, openForm, openPanel, options, postingFields, reviewCodes, scheduleFields, scheduleKinds } from './forms.mjs';
import { csv, ics, markdown } from './exports.mjs';
import { addDays } from './workflow.mjs';

const preferences = {
  get(key,fallback) { try { return JSON.parse(localStorage.getItem('careerops.'+key)) ?? fallback; } catch { return fallback; } },
  set(key,value) { try { localStorage.setItem('careerops.'+key,JSON.stringify(value)); } catch { /* browser storage unavailable */ } }
};
const pages = {overview:['개요','Overview'],schedule:['일정표','Schedule'],jobs:['공고 탐색','Job Explorer'],
  applications:['지원 현황','Applications'],unreviewed:['미분석 공고','Unreviewed Jobs'],
  compare:['기업 비교','Compare'],activity:['변경 이력','Activity Log'],settings:['설정','Settings'],engineering:['기술 정보','Engineering']};
const state = {
  language:preferences.get('language','ko'),theme:preferences.get('theme','light'),page:preferences.get('home','overview'),
  token:'',data:null,query:'',pageNumber:0,selected:new Set(),details:new Map(),jobFilter:preferences.get('jobFilter',{}),
  scheduleFilter:preferences.get('scheduleFilter',{range:'all',kind:'',company:'',conditional:true}),bucket:'active',month:null
};
const t = (ko,en)=>state.language==='ko'?ko:en;
const titleFor = key=>t(...pages[key]);
const translated = key=>labelFor(key,t);
const unreviewed = new Set(['new','unreviewed','needs_verification']);
const empty = ()=>t('조건에 맞는 항목이 없습니다.','No matching records.');
const company = id=>state.data.companies.find(item=>item.id===id);
const companyName = id=>company(id)?.name ?? '—';
const posting = id=>state.data.postings.find(item=>item.id===id);
const application = id=>state.data.applications.find(item=>item.posting_id===id);
const showDate = row=>[
  row.start_date ?? t('날짜 미정','Date TBD'),row.start_time,
  row.end_date || row.end_time ? '–' : null,row.end_date,row.end_time
].filter(Boolean).join(' ');
function report(message,error=false) {
  $('notice').textContent=message;
  $('notice').dataset.error=String(error);
}
async function api(path,method='GET',body,version) {
  const headers = {authorization:'Bearer '+state.token};
  if (body!==undefined) headers['content-type']='application/json';
  if (version!==undefined) headers['if-match']='"'+version+'"';
  const response = await fetch('/api/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) {
    if (response.status===401 && state.data) {
      state.token='';
      state.data=null;
      render();
    }
    throw new Error(data.error ?? t('요청에 실패했습니다.','Request failed.'));
  }
  return data;
}
async function load() {
  state.data=await api('workspace');
  state.month ??=state.data.today.slice(0,7);
  state.details.clear();
  for (const id of state.selected) if (!posting(id)) state.selected.delete(id);
  render();
}
async function mutate(path,method,data,version) {
  await api(path,method,data,version);
  try { await load(); report(t('저장했습니다.','Saved.')); }
  catch(error) { report(t('저장했으나 새로고침에 실패했습니다. ','Saved. Refresh failed. ')+error.message,true); }
}
async function details(id) {
  if (!state.details.has(id)) state.details.set(id,await api('job_details/'+id));
  return state.details.get(id);
}
function navigate(key) {
  state.page=key;
  state.pageNumber=0;
  render();
  if (key==='compare') safe(loadComparison);
}
async function loadComparison() {
  await Promise.all([...state.selected].map(details));
  if (state.page==='compare') render();
}
function login() {
  const input=h('input',{type:'password',autocomplete:'off',required:true});
  const submit=h('button',{type:'submit',class:'primary'},t('접속','Connect'));
  return h('form',{class:'login stack',onsubmit:async event=>{
    event.preventDefault();
    submit.disabled=true;
    state.token=input.value;
    report(t('불러오는 중…','Loading…'));
    try { await load(); report(''); }
    catch(error) { state.token=''; report(error.message,true); submit.disabled=false; input.focus(); }
  }},h('h1',{},t('CareerOps 접속','Connect to CareerOps')),
  h('label',{},t('소유자 접근 키','Owner access key'),input),submit);
}
function heading(name,...actions) {
  return h('div',{class:'heading'},h('h1',{},titleFor(name)),h('div',{class:'actions'},actions));
}
function card(title,...children) { return h('section',{class:'card'},h('h2',{},title),children); }
function pill(text) { return h('span',{class:'pill'},text); }
function jobTitle(row) {
  return row ? companyName(row.company_id)+' · '+row.title+' · '+row.round_key : '—';
}
function showPosting(id) {
  const row = posting(id);
  if (row) safe(()=>jobDetail(row));
}
async function jobDetail(row) {
  const metadata=await details(row.id);
  const org=company(row.company_id);
  const information = [
    [t('기업','Company'),org?.name],[t('별칭','Aliases'),state.data.aliases.filter(item=>item.company_id===row.company_id).map(item=>item.alias).join(', ')],
    [t('회차와 직무코드','Round and role code'),row.round_key+' / '+row.role_code],
    [t('근무지역','Work location'),row.location],[t('담당 업무','Responsibilities'),row.responsibilities],
    [t('근로 조건','Employment terms'),[row.employment_type,row.compensation].filter(Boolean).join(' · ')],
    [t('모집인원','Headcount'),row.headcount],[t('마감','Deadline'),[row.deadline_date,row.deadline_time].filter(Boolean).join(' ')],
    [t('이전 회차','Previous posting'),row.previous_id?jobTitle(posting(row.previous_id)):null]
  ];
  openPanel(row.title,t,h('div',{class:'stack'},
    h('dl',{},information.map(([key,val])=>[h('dt',{class:'muted'},key),h('dd',{},valueText(val))])),
    h('section',{},h('h3',{},t('지원 요건','Qualifications')),
      metadata.requirements.length ? h('ul',{},metadata.requirements.map(item=>h('li',{},(item.kind==='required'?t('필수','Required'):t('우대','Preferred'))+' · '+item.criterion))) : h('p',{class:'muted'},empty())),
    h('section',{},h('h3',{},t('출처','Sources')),metadata.sources.length ? h('ul',{},metadata.sources.map(item=>
      h('li',{},h('a',{href:item.url,target:'_blank',rel:'noopener noreferrer'},item.url),
        ' · '+valueText(item.verified_on),item.evidence?' · '+item.evidence:null))) : h('p',{class:'muted'},empty())),
    h('div',{class:'actions'},button(t('공고 수정','Edit posting'),()=>safe(()=>editJob(row))),
      button(t('지원 상태','Application status'),()=>editApplication(row)),
      org && button(t('기업 수정','Edit company'),()=>editCompany(org)))));
}
function safe(action) {
  Promise.resolve().then(action).catch(error=>report(error.message,true));
}
function editCompany(row={}) {
  const aliases=state.data.aliases.filter(item=>item.company_id===row.id).map(item=>item.alias);
  openForm({title:row.id?t('기업 수정','Edit company'):t('기업 추가','Add company'),t,specs:companyFields(t),row:{...row,aliases},
    save:body=>mutate(row.id?'companies/'+row.id:'companies',row.id?'PATCH':'POST',body,row.version),
    remove:row.id?()=>mutate('companies/'+row.id,'DELETE',undefined,row.version):null});
}
async function editJob(row={}) {
  if (!state.data.companies.length) { editCompany(); return; }
  const metadata=row.id ? await details(row.id) : {requirements:[],sources:[]};
  openForm({title:row.id?t('공고 수정','Edit posting'):t('공고 추가','Add posting'),t,specs:postingFields(t,state.data,row),
    row:{...row,...metadata,required:metadata.requirements,preferred:metadata.requirements},
    save:({required,preferred,...body})=>mutate(row.id?'job_postings/'+row.id:'job_postings',row.id?'PATCH':'POST',{
      ...body,requirements:[...required.map(criterion=>({kind:'required',criterion})),...preferred.map(criterion=>({kind:'preferred',criterion}))]
    },row.version),
    remove:row.id?()=>mutate('job_postings/'+row.id,'DELETE',undefined,row.version):null});
}
function editSchedule(row={}) {
  if (!state.data.postings.length) { safe(()=>editJob()); return; }
  openForm({title:row.id?t('일정 수정','Edit schedule'):t('일정 추가','Add schedule'),t,specs:scheduleFields(t,state.data,row,companyName),row,
    save:body=>mutate(row.id?'schedules/'+row.id:'schedules',row.id?'PATCH':'POST',body,row.version),
    remove:row.id?()=>mutate('schedules/'+row.id,'DELETE',undefined,row.version):null});
}
function editApplication(job) {
  const row=application(job.id) ?? {};
  openForm({title:jobTitle(job),t,specs:applicationFields(t,row),row,
    save:({confirm_submission,...data})=>{
      if (confirm_submission || (data.stage==='submitted' && (!row.stage || row.stage==='not_submitted'))) data.confirm_submission=Boolean(confirm_submission);
      if (!row.id) data.posting_id=job.id;
      return mutate(row.id?'applications/'+row.id:'applications',row.id?'PATCH':'POST',data,row.version);
    }});
}
function overview() {
  const data=state.data;
  const metrics=[
    ['candidates',t('전체 후보','Candidates')],['planned',t('지원예정','Planned')],['inProgress',t('진행 중','In progress')],
    ['waiting',t('결과 대기','Awaiting results')],['interviews',t('면접 예정','Interviews')],['unreviewed',t('미분석·검증','To review')],
    ['approaching',t('7일 내 마감','Deadlines in 7 days')]
  ];
  const next=data.schedules.find(row=>row.bucket==='active');
  const focus = (title,ids)=>card(title,ids.length ? h('ul',{class:'summary-list'},ids.slice(0,8).map(id=>h('li',{},button(jobTitle(posting(id)),()=>showPosting(id))))) : h('p',{class:'muted'},empty()));
  return [heading('overview',button(t('일정표 보기','Open schedule'),()=>navigate('schedule'),{class:'primary'})),
    h('div',{class:'stack'},
      h('div',{class:'grid'},metrics.map(([key,label])=>h('div',{class:'card'},h('span',{class:'muted'},label),h('strong',{class:'metric'},data.metrics[key])))),
      h('div',{class:'grid'},card(t('다음 일정','Next event'),next ? button(showDate(next)+' · '+next.title,()=>editSchedule(next)) : h('p',{class:'muted'},empty())),
        card(t('데이터 신선도','Data freshness'),h('p',{},t('최근 공식 확인','Last source check')+' · '+valueText(data.metrics.verified)),
          h('p',{},t('최근 스캔','Last scan')+' · '+valueText(data.metrics.scans)))),
      h('div',{class:'grid'},focus(t('임박한 마감','Approaching deadlines'),data.focus.deadlines),
        focus(t('결과 대기','Awaiting results'),data.focus.waiting),focus(t('출처 재확인 필요','Source verification needed'),data.focus.verification)))];
}
function filterJob(row) {
  const query=state.query.toLocaleLowerCase();
  const aliases=state.data.aliases.filter(item=>item.company_id===row.company_id).map(item=>item.alias);
  const text=[jobTitle(row),row.location,row.role_code,row.responsibilities,...aliases].filter(Boolean).join(' ').toLocaleLowerCase();
  const filter=state.jobFilter;
  return (!query || text.includes(query)) && (!filter.company || row.company_id===filter.company)
    && (!filter.location || row.location===filter.location) && (!filter.size || company(row.company_id)?.size_class===filter.size)
    && (!filter.status || row.posting_status===filter.status) && (!filter.review || row.review_status===filter.review);
}
function jobList(unreviewedOnly=false) {
  const filter=state.jobFilter;
  const rows=state.data.postings.filter(row=>filterJob(row) && (!unreviewedOnly || unreviewed.has(row.review_status)));
  const sorted=filter.sort==='updated' ? ordered(rows,row=>row.updated_at).filter(row=>row.updated_at).reverse().concat(rows.filter(row=>!row.updated_at)) :
    ordered(rows,row=>filter.sort==='company'?companyName(row.company_id):row.deadline_date);
  const perPage=12;
  const last=Math.max(0,Math.ceil(sorted.length/perPage)-1);
  state.pageNumber=Math.min(last,state.pageNumber);
  const visible=sorted.slice(state.pageNumber*perPage,(state.pageNumber+1)*perPage);
  const reset=(key,value)=>{ filter[key]=value; state.pageNumber=0; render(); };
  const chosen = (label,key,items,all=true)=>select([...all?[['',label]]:[],...items],filter[key] ?? (all?'':items[0][0]),v=>reset(key,v),{'aria-label':label});
  const unique = (values)=>[...new Set(values.filter(Boolean))].sort().map(value=>[value,value]);
  const orgs=state.data.companies.map(item=>[item.id,item.name]);
  return [heading(state.page,button(t('기업 추가','Add company'),()=>editCompany()),button(t('공고 추가','Add posting'),()=>safe(()=>editJob()),{class:'primary'})),
    h('div',{class:'toolbar'},chosen(t('모든 기업','All companies'),'company',orgs),
      chosen(t('모든 지역','All locations'),'location',unique(state.data.postings.map(row=>row.location))),
      chosen(t('모든 규모','All sizes'),'size',unique(state.data.companies.map(row=>row.size_class))),
      chosen(t('공고 상태 전체','All posting statuses'),'status',options(['upcoming','open','closed','changed','cancelled','unverified'],t)),
      chosen(t('검토 상태 전체','All review statuses'),'review',options(reviewCodes,t)),
      chosen(t('정렬','Sort'),'sort',[['deadline',t('마감일순','Deadline')],['company',t('기업명순','Company')],['updated',t('최근 수정순','Recently updated')]],false),
      button(t('필터 저장','Save filters'),()=>{preferences.set('jobFilter',filter);report(t('필터를 저장했습니다.','Filters saved.'));})),
    table([t('비교','Compare'),t('기업·직무','Company and role'),t('마감','Deadline'),t('지역','Location'),t('공고','Posting'),t('검토','Review'),t('전형','Stage')],
      visible.map(row=>[h('input',{type:'checkbox',checked:state.selected.has(row.id),'aria-label':jobTitle(row)+' '+t('비교 선택','select for comparison'),
        onchange:event=>{
          if (event.target.checked && state.selected.size>=5) { event.target.checked=false; report(t('최대 5개까지 선택할 수 있습니다.','Select up to five postings.'),true);return; }
          if (event.target.checked) state.selected.add(row.id); else state.selected.delete(row.id);
          $('compare-count').textContent=String(state.selected.size);
        }}),button(jobTitle(row),()=>showPosting(row.id)),valueText(row.deadline_date),valueText(row.location),
        pill(translated(row.posting_status)),translated(row.review_status),translated(application(row.id)?.stage ?? 'not_submitted')]),titleFor(state.page),empty()),
    h('div',{class:'pager'},h('div',{class:'actions'},button(t('이전','Previous'),()=>{state.pageNumber--;render();},{disabled:state.pageNumber===0}),
      h('span',{},(state.pageNumber+1)+' / '+(last+1)),button(t('다음','Next'),()=>{state.pageNumber++;render();},{disabled:state.pageNumber===last})),
      button('',()=>navigate('compare'),{id:'compare-button'})),
    h('span',{id:'compare-caption',hidden:true},t('선택 공고 비교','Compare selected postings'))];
}
function appList() {
  return [heading('applications'),
    table([t('기업·직무','Company and role'),t('지원 의사','Intent'),t('실제 전형','Actual stage'),t('제출 시각','Submitted at'),t('관리','Manage')],
      state.data.postings.filter(filterJob).map(row=>{
        const app=application(row.id);
        return [button(jobTitle(row),()=>showPosting(row.id)),app?.intent==='planned'?t('A 일반','Planned, primary'):translated(app?.intent ?? 'undecided'),
          translated(app?.stage ?? 'not_submitted'),valueText(app?.submitted_at),button(t('상태 수정','Edit status'),()=>editApplication(row))];
      }),titleFor('applications'),empty())];
}
function scheduleRows() {
  const filter=state.scheduleFilter;
  const data=state.data;
  const month=state.month;
  const start=filter.range==='today'?data.today:filter.range==='week'?addDays(data.today,-((new Date(data.today+'T00:00:00Z').getUTCDay()+6)%7)):filter.range==='month'?month+'-01':null;
  const end=filter.range==='today'?data.today:filter.range==='week'?addDays(start,6):filter.range==='month'?addDays(monthAfter(month,1)+'-01',-1):null;
  return data.schedules.filter(row=>{
    const job=posting(row.posting_id);
    return row.bucket===state.bucket && (filter.conditional || row.status!=='conditional') &&
      (!filter.kind || row.kind===filter.kind || (filter.kind==='result' && row.kind==='screening')) &&
      (!filter.company || job?.company_id===filter.company) &&
      (!state.query || (jobTitle(job)+' '+row.title).toLocaleLowerCase().includes(state.query.toLocaleLowerCase())) &&
      (state.bucket==='undated'||!start||(row.start_date<=end && (row.end_date ?? row.start_date)>=start));
  });
}
function monthAfter(month,delta) {
  const date=new Date(month+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+delta);
  return date.toISOString().slice(0,7);
}
function calendar(rows) {
  const first=state.month+'-01';
  const last=Number(addDays(monthAfter(state.month,1)+'-01',-1).slice(-2));
  const gap=(new Date(first+'T00:00:00Z').getUTCDay()+6)%7;
  return h('div',{class:'calendar'},
    Array.from({length:gap},()=>h('div',{class:'day blank','aria-hidden':'true'})),
    Array.from({length:last},(_,i)=>{
      const date=state.month+'-'+String(i+1).padStart(2,'0');
      const items=rows.filter(row=>row.start_date<=date && (row.end_date ?? row.start_date)>=date);
      return h('div',{class:'day'+(date===state.data.today?' current':'')},
        h('strong',{'aria-label':date},String(i+1)),items.map(row=>button(row.title,()=>editSchedule(row))));
    }));
}
function scheduleStatus(row) {
  return [translated(row.status==='planned'?row.certainty:row.status),row.conflict?t('시간 충돌','Time overlap'):null].filter(Boolean).join(' · ');
}
function scheduleNotes(row) {
  const predecessor=state.data.schedules.find(item=>item.id===row.predecessor_id);
  return [row.location,row.arrival_time?t('도착 ','Arrive ')+row.arrival_time:null,row.admission_deadline?t('입실 마감 ','Last admission ')+row.admission_deadline:null,
    row.preparation,row.condition_note,predecessor?t('선행 일정 ','After ')+predecessor.title:null,row.notes].filter(Boolean).join(' · ');
}
function schedule() {
  const filter=state.scheduleFilter;
  const rows=scheduleRows();
  const change=(key,value)=>{filter[key]=value;render();};
  const headers=[t('날짜·시간','Date and time'),t('기업·직무','Company and role'),t('전형·일정','Event'),t('현재 상태','Status'),t('장소·비고','Location and notes')];
  const raw=rows.map(row=>[showDate(row),jobTitle(posting(row.posting_id)),translated(row.kind)+' · '+row.title,scheduleStatus(row),scheduleNotes(row)]);
  return [heading('schedule',button(t('일정 추가','Add event'),()=>editSchedule(),{class:'primary'})),
    h('div',{class:'toolbar'},[['active',t('활성 일정','Active')],['undated',t('날짜 미정','Undated')],
      ['history',t('완료·과거','History')],['excluded',t('활성 제외','Inactive')]].map(([key,label])=>button(label,()=>{state.bucket=key;render();},{'aria-pressed':state.bucket===key,class:state.bucket===key?'primary':''}))),
    h('div',{class:'toolbar'},
      select([['all',t('전체 기간','All dates')],['today',t('오늘','Today')],['week',t('이번 주','This week')],['month',t('월간','Month')]],filter.range,v=>change('range',v),{'aria-label':t('기간','Date range')}),
      select([['',t('전체 전형','All events')],...options(['deadline','interview','result',...scheduleKinds.filter(key=>!['deadline','interview','result'].includes(key))],t)],filter.kind,v=>change('kind',v),{'aria-label':t('전형 종류','Event type')}),
      select([['',t('모든 기업','All companies')],...state.data.companies.map(row=>[row.id,row.name])],filter.company,v=>change('company',v),{'aria-label':t('기업','Company')}),
      h('label',{},h('input',{type:'checkbox',checked:filter.conditional,onchange:e=>change('conditional',e.target.checked)}),t('조건부 포함','Include conditional')),
      button(t('필터 저장','Save filters'),()=>{preferences.set('scheduleFilter',filter);report(t('필터를 저장했습니다.','Filters saved.'));})),
    filter.range==='month' && state.bucket!=='undated' ? h('div',{class:'stack'},
      h('div',{class:'toolbar'},button(t('지난 달','Previous month'),()=>{state.month=monthAfter(state.month,-1);render();}),h('strong',{},state.month),
        button(t('다음 달','Next month'),()=>{state.month=monthAfter(state.month,1);render();})),calendar(rows)) : null,
    table(headers.filter((_,i)=>i!==4 || preferences.get('notesColumn',true)),
      raw.map((values,i)=>[values[0],values[1],button(values[2],()=>editSchedule(rows[i])),pill(values[3]),
        ...(preferences.get('notesColumn',true)?[valueText(values[4])]:[])]),titleFor('schedule'),empty()),
    h('div',{class:'pager'},h('div',{class:'actions'},
      button(t('Markdown 복사','Copy Markdown'),()=>safe(async()=>{await navigator.clipboard.writeText(markdown(headers,raw));report(t('복사했습니다.','Copied.'));})),
      button('CSV',()=>download('careerops-schedule.csv',csv(headers,raw),'text/csv')),
      button('ICS',()=>download('careerops-schedule.ics',ics(rows),'text/calendar'),{disabled:!rows.some(row=>row.start_date)})))];
}
function compare() {
  const jobs=[...state.selected].map(posting).filter(Boolean);
  const orgs=state.data.companies;
  const controls=h('div',{class:'toolbar'},select([['',t('공고 선택','Select posting')],
    ...state.data.postings.filter(row=>!state.selected.has(row.id)).map(row=>[row.id,jobTitle(row)])],'',id=>{
    if (id && state.selected.size<5) state.selected.add(id);
    render();
    safe(loadComparison);
  },{'aria-label':t('비교 공고 추가','Add posting to comparison'),disabled:jobs.length>=5}),
  jobs.map(row=>button(jobTitle(row)+' ×',()=>{state.selected.delete(row.id);render();})));
  const sorted=state.data.schedules.filter(row=>row.bucket==='active');
  const next=id=>sorted.find(row=>row.posting_id===id);
  const heads=[t('비교 항목','Field'),...jobs.map(jobTitle)];
  const entries=[
    [t('담당 업무','Responsibilities'),row=>row.responsibilities],[t('근무지역','Work location'),row=>row.location],
    [t('처우','Compensation'),row=>row.compensation],[t('기업 규모','Size class'),row=>orgs.find(org=>org.id===row.company_id)?.size_class],
    [t('고용형태','Employment type'),row=>row.employment_type],[t('채용 마감','Application deadline'),row=>row.deadline_date],
    [t('필수 요건','Required qualifications'),row=>state.details.get(row.id)?.requirements.filter(item=>item.kind==='required').map(item=>item.criterion).join(' · ')],
    [t('우대 요건','Preferred qualifications'),row=>state.details.get(row.id)?.requirements.filter(item=>item.kind==='preferred').map(item=>item.criterion).join(' · ')],
    [t('다음 일정','Next event'),row=>next(row.id)?showDate(next(row.id))+' · '+next(row.id).title:null],
    [t('적합도 평가','Fit assessment'),()=>null]
  ];
  const matrix=entries.map(([label,accessor])=>[label,...jobs.map(row=>valueText(accessor(row)))]);
  return [heading('compare'),controls,jobs.length<2 ? h('p',{class:'card muted'},t('비교할 공고를 2~5개 선택하세요.','Choose two to five postings.')) :
    h('div',{class:'stack'},table(heads,matrix,titleFor('compare'),empty()),h('div',{class:'actions'},
      button('CSV',()=>download('careerops-comparison.csv',csv(heads,matrix),'text/csv')),
      button(t('Markdown 복사','Copy Markdown'),()=>safe(async()=>{await navigator.clipboard.writeText(markdown(heads,matrix));report(t('복사했습니다.','Copied.'));}))))];
}
function auditDetail(row) {
  const before=JSON.parse(row.before_json);
  const after=JSON.parse(row.after_json);
  const undo=before && !after.deleted_at && ['companies','job_postings','schedules'].includes(row.entity) &&
    button(t('변경 되돌리기','Undo edit'),()=>safe(async()=>{
      if (window.confirm(t('이 변경을 이전 값으로 되돌릴까요?','Restore the previous values for this edit?'))) {
        await mutate('undo/'+row.seq,'POST');
        $('panel').close();
      }
    }),{class:'danger'});
  openPanel(t('변경 전후','Before and after'),t,h('div',{class:'stack'},
    h('h3',{},t('이전 값','Before')),h('pre',{},JSON.stringify(before,null,2)),
    h('h3',{},t('변경 값','After')),h('pre',{},JSON.stringify(after,null,2)),undo));
}
function previewBatch() {
  const input=h('textarea',{rows:9,placeholder:'[{"type":"job_postings","id":"…","version":1,"patch":{"review_status":"reviewed"}}]'});
  const results=h('div',{role:'status'});
  openPanel(t('일괄 수정 드라이런','Preview batch edits'),t,h('div',{class:'stack'},
    h('label',{class:'fields'},t('수정 목록 JSON · 최대 30건','JSON edit list · up to 30 records'),input),
    button(t('유효성 검사','Validate'),async()=>{
      try {
        const items=JSON.parse(input.value);
        const rows=await api('batch_preview','POST',{items});
        const errors=rows.filter(row=>!row.ok);
        results.replaceChildren(h('p',{},t('검증 통과','Passed')+' '+String(rows.length-errors.length)+' / '+rows.length),
          errors.length ? h('ul',{},errors.map(row=>h('li',{},(row.index+1)+' · '+row.error))) : null,
          errors.length ? button(t('오류 CSV 저장','Download errors CSV'),()=>download('careerops-batch-errors.csv',
            csv(['row','id','error'],errors.map(row=>[row.index+1,items[row.index]?.id,row.error])),'text/csv')) : null);
      } catch(error) { results.textContent=error.message; }
    },{class:'primary'}),results));
}
function activity() {
  const logs=state.data.activity;
  return [heading('activity',button(t('일괄 수정 드라이런','Preview batch edits'),previewBatch)),table([t('변경 시각','Changed at'),t('대상','Entity'),t('작업','Action'),t('보기','Details')],
    logs.map(row=>[row.changed_at,row.entity,row.before_json?t('수정','Update'):t('생성','Create'),
      button(t('변경 전후','Before and after'),()=>auditDetail(row))]),titleFor('activity'),empty())];
}
function settings() {
  return [heading('settings'),card(t('처음 열 화면','Default page'),select([['overview',titleFor('overview')],['schedule',titleFor('schedule')]],preferences.get('home','overview'),
    value=>{preferences.set('home',value);report(t('저장했습니다.','Saved.'));},{'aria-label':t('기본 화면','Home page')})),
    card(t('일정표 열','Schedule columns'),h('label',{},h('input',{type:'checkbox',checked:preferences.get('notesColumn',true),
      onchange:event=>preferences.set('notesColumn',event.target.checked)}),t('장소·비고 표시','Show location and notes')))];
}
function engineering() {
  return [heading('engineering'),card(t('실행 환경','Runtime'),h('p',{},t('Node.js HTTP 서버 · SQLite 파일 DB','Node.js HTTP server · SQLite file database')),
    h('p',{},t('일정표 시간대 · Asia/Seoul','Schedule time zone · Asia/Seoul')))];
}
const renderers={overview,schedule,jobs:()=>jobList(),unreviewed:()=>jobList(true),applications:appList,compare,activity,settings,engineering};

function render() {
  document.documentElement.lang=state.language;
  document.documentElement.dataset.theme=state.theme;
  $('language').textContent=state.language==='ko'?'EN':'한국어';
  $('theme').setAttribute('aria-label',t('색상 모드 전환','Toggle color theme'));
  $('global-search').placeholder=t('기업·직무·일정 검색','Find a company, role, or event');
  $('global-search').setAttribute('aria-label',$('global-search').placeholder);
  $('global-search').disabled=!state.data;
  $('disconnect').textContent=t('연결 해제','Disconnect');
  $('disconnect').hidden=!state.data;
  $('navigation').replaceChildren(...(state.data?Object.keys(pages).map(key=>button(titleFor(key),()=>navigate(key),
    {'aria-current':state.page===key?'page':null})):[]));
  if (!state.data) { $('screen').replaceChildren(login()); return; }
  if (!Object.hasOwn(renderers,state.page)) state.page='overview';
  $('screen').replaceChildren(...renderers[state.page]().filter(Boolean));
  const compareButton=$('compare-button');
  if (compareButton) compareButton.replaceChildren($('compare-caption').textContent+' ',h('span',{id:'compare-count'},String(state.selected.size)));
}

$('theme').addEventListener('click',()=>{
  state.theme=state.theme==='light'?'dark':'light';
  preferences.set('theme',state.theme);render();
});
$('language').addEventListener('click',()=>{
  state.language=state.language==='ko'?'en':'ko';
  preferences.set('language',state.language);render();
});
$('disconnect').addEventListener('click',()=>{
  state.token='';state.data=null;state.query='';state.selected.clear();state.details.clear();$('global-search').value='';report('');render();
});
$('global-search').addEventListener('input',event=>{
  state.query=event.target.value.trim();state.pageNumber=0;
  if (!['jobs','unreviewed','applications','schedule'].includes(state.page)) state.page='jobs';
  render();
});
render();
