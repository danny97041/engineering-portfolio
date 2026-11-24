import { $, button, h, select } from './dom.mjs';
import { intents, nextStages } from './workflow.mjs';

const codes = {
  new:['신규','New'],unreviewed:['미분석','Unreviewed'],needs_verification:['검증 필요','Needs verification'],reviewed:['분석완료','Reviewed'],paused:['보류','Paused'],
  upcoming:['접수 전','Upcoming'],open:['접수 중','Open'],closed:['종료','Closed'],changed:['변경','Changed'],cancelled:['취소','Cancelled'],unverified:['미확인','Unverified'],
  confirmed:['확정','Confirmed'],planned:['예정','Planned'],conditional:['조건부','Conditional'],completed:['완료','Completed'],
  secondary:['A 후순위','Planned, secondary'],declined:['미지원 확정','Declined'],withdraw_pending:['포기 예정','Withdrawal planned'],withdrawn:['포기 확정','Withdrawn'],
  undecided:['미정','Undecided'],not_submitted:['미제출','Unsubmitted'],submitted:['지원완료','Submitted'],screening_pending:['서류 대기','Screening pending'],
  screening_passed:['서류 합격','Screening passed'],test_planned:['필기 예정','Test planned'],test_completed:['필기 완료','Test completed'],
  interview_planned:['면접 예정','Interview planned'],interview_completed:['면접 완료','Interview completed'],final_pending:['최종 대기','Final decision pending'],
  offered:['최종 합격','Offer received'],rejected:['불합격','Rejected'],hired:['입사 확정','Hired'],
  opening:['접수 시작','Opening'],deadline:['접수 마감','Deadline'],screening:['서류 발표','Screening result'],test:['필기·과제','Test or assignment'],
  aptitude:['인적성','Aptitude test'],coding:['코딩테스트','Coding test'],interview:['면접','Interview'],result:['최종 발표','Final result'],onboarding:['입사·임용','Onboarding'],custom:['사용자 지정','Custom']
};
export const scheduleKinds = ['opening','deadline','screening','test','aptitude','coding','interview','result','onboarding','custom'];
export const reviewCodes = ['new','unreviewed','needs_verification','reviewed','paused'];
export const labelFor = (key,t) => codes[key] ? t(...codes[key]) : key ?? '—';
export const options = (keys,t) => keys.map(key=>[key,labelFor(key,t)]);
const splitLines = value=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);

function field(name, label, type='text', config={}) { return {name,label,type,...config}; }

export function companyFields(t) {
  return [
    field('name',t('기업명','Company name'),'text',{required:true}),
    field('size_class',t('규모 등급','Size class')),
    field('institution_type',t('기관 유형','Organization type')),
    field('source_url',t('공식 출처','Official source'),'url'),
    field('verified_on',t('확인일','Verified on'),'date'),
    field('aliases',t('별칭 · 줄마다 하나','Aliases · one per line'),'textarea',{parse:splitLines,format:items=>items.join('\n')})
  ];
}

export function postingFields(t, data, row) {
  const requirement = kind=>({
    parse:splitLines,format:items=>items.filter(item=>item.kind===kind).map(item=>item.criterion).join('\n')
  });
  return [
    field('company_id',t('기업','Company'),'select',{required:true,options:data.companies.map(company=>[company.id,company.name])}),
    field('title',t('대표 직무','Role title'),'text',{required:true}),
    field('round_key',t('모집 회차','Recruitment round'),'text',{required:true}),
    field('role_code',t('직무 코드','Role code'),'text',{required:true}),
    field('posting_number',t('공고 번호','Posting number')),
    field('open_date',t('접수 시작일','Opening date'),'date'),
    field('location',t('근무지역','Work location')),field('employment_type',t('고용형태','Employment type')),
    field('headcount',t('모집인원','Headcount'),'number',{min:0,parse:Number}),field('compensation',t('처우','Compensation')),
    field('deadline_date',t('마감일','Deadline date'),'date'),field('deadline_time',t('마감 시각','Deadline time'),'time'),
    field('review_status',t('검토 상태','Review status'),'select',{options:options(reviewCodes,t),initial:'new'}),
    field('posting_status',t('공고 상태','Posting status'),'select',{options:options(['upcoming','open','closed','changed','cancelled','unverified'],t),initial:'unverified'}),
    field('previous_id',t('이전 회차','Previous posting'),'select',{options:data.postings.filter(item=>item.id!==row.id)
      .map(item=>[item.id,item.title+' · '+item.round_key])}),
    field('responsibilities',t('담당 업무','Responsibilities'),'textarea'),
    field('required',t('필수 요건 · 줄마다 하나','Required qualifications · one per line'),'textarea',requirement('required')),
    field('preferred',t('우대 요건 · 줄마다 하나','Preferred qualifications · one per line'),'textarea',requirement('preferred')),
    field('sources',t('공식 출처 · URL | 확인일 | 근거','Sources · URL | verification date | evidence'),'textarea',{
      parse:value=>splitLines(value).map(line=>{
        const [url,date,...evidence] = line.split('|').map(segment=>segment.trim());
        return {url,verified_on:date || null,evidence:evidence.join(' | ') || null};
      }),
      format:items=>items.map(item=>[item.url,item.verified_on,item.evidence].map(part=>part ?? '').join(' | ')).join('\n')
    })
  ];
}
export function scheduleFields(t,data,row,companyName) {
  const mapped = data.schedules.filter(item=>item.id!==row.id).map(item=>[item.id,item.title+' · '+valueOrDash(item.start_date)]);
  const knownKinds = [...new Set([...scheduleKinds,...(row.kind?[row.kind]:[])])];
  return [
    field('posting_id',t('기업·직무','Company and role'),'select',{required:true,options:data.postings
      .map(item=>[item.id,companyName(item.company_id)+' · '+item.title+' · '+item.round_key])}),
    field('title',t('일정명','Event title'),'text',{required:true}),
    field('kind',t('전형 종류','Event type'),'select',{required:true,options:options(knownKinds,t),initial:'custom'}),
    field('start_date',t('시작일','Start date'),'date'),field('end_date',t('종료일','End date'),'date'),
    field('start_time',t('시작 시각','Start time'),'time'),field('end_time',t('종료 시각','End time'),'time'),
    field('arrival_time',t('도착 권장','Recommended arrival'),'time'),field('admission_deadline',t('입실 마감','Last admission'),'time'),
    field('location',t('전형 장소','Event location')),
    field('certainty',t('확정 여부','Certainty'),'select',{options:options(['confirmed','planned','unverified'],t),initial:'planned'}),
    field('status',t('일정 상태','Schedule status'),'select',{options:options(['planned','conditional','completed','cancelled'],t),initial:'planned'}),
    field('predecessor_id',t('선행 전형','Preceding event'),'select',{options:mapped}),
    field('condition_note',t('조건','Condition')),field('preparation',t('준비물','Preparation')),
    field('source_url',t('일정 출처','Schedule source'),'url'),field('verified_on',t('확인일','Verified on'),'date'),
    field('notes',t('비고','Notes'),'textarea')
  ];
}
const valueOrDash = val => val ?? '—';

export function applicationFields(t,row) {
  const stage = row.stage ?? 'not_submitted';
  const intentOptions = options(intents,t).map(([key,label])=>[key,key==='planned'?t('A 일반','Planned, primary'):label]);
  return [
    field('intent',t('지원 의사','Application intent'),'select',{options:intentOptions,initial:'undecided'}),
    field('stage',t('실제 전형','Actual stage'),'select',{options:options([stage,...nextStages(stage)],t),initial:stage}),
    ...(stage==='not_submitted'?[field('confirm_submission',t('실제 지원서 제출을 확인했습니다','I confirm that I submitted the application'),'checkbox')]:[])
  ];
}
function makeInput(spec,current) {
  const value = (spec.format && Array.isArray(current) ? spec.format(current) : current) ?? spec.initial ?? '';
  if (spec.type==='select') return select(spec.required || spec.initial ? spec.options : [['','—'],...spec.options],value,null,{required:spec.required});
  if (spec.type==='textarea') return h('textarea',{value,maxlength:spec.parse?8000:500});
  if (spec.type==='checkbox') return h('input',{type:'checkbox',checked:value===true});
  return h('input',{type:spec.type,value,required:spec.required,min:spec.min,maxlength:spec.type==='url'?2048:500});
}

export function openPanel(title,t,node) {
  const dialog = $('panel');
  dialog.replaceChildren(h('header',{class:'dialog-header'},h('h2',{id:'panel-title'},title),
    button(t('닫기','Close'),()=>dialog.close())),node);
  if (!dialog.open) dialog.showModal();
}

export function openForm({title,t,specs,row={},save,remove,tail}) {
  const controls = specs.map(spec=>[spec,makeInput(spec,row[spec.name])]);
  const notice = h('p',{role:'status',class:'error'});
  const actions = h('div',{class:'actions'},h('button',{class:'primary',type:'submit'},t('변경 확인','Review changes')));
  if (remove) actions.append(button(t('삭제','Delete'),async()=>{
    if (!window.confirm(t('이 항목을 삭제하시겠습니까?','Delete this record?'))) return;
    try { await remove(); $('panel').close(); }
    catch(error) { notice.textContent=error.message; }
  },{class:'danger'}));
  const preview = h('section',{hidden:true});
  const form = h('form',{class:'stack',onsubmit:event=>{
    event.preventDefault();
    try {
      const body = Object.fromEntries(controls.map(([spec,input])=>[
        spec.name,spec.type==='checkbox' ? input.checked : spec.parse ? (spec.type==='number' && !input.value ? null : spec.parse(input.value)) : input.value || null
      ]));
      const changes = controls.map(([spec,input])=>{
        const initial=makeInput(spec,row[spec.name]);
        return [spec.label,input.type==='checkbox' ? (initial.checked?t('확인','Confirmed'):'—') : initial.value || '—',
          input.type==='checkbox' ? (input.checked?t('확인','Confirmed'):'—') : input.value || '—'];
      });
      preview.replaceChildren(h('h3',{},t('저장할 내용','Values to save')), h('dl',{},changes
        .filter(([,before,after])=>!row.id || before!==after)
        .map(([label,before,after])=>[h('dt',{},label),h('dd',{},row.id?before+' → '+after:after)])),
        button(t('저장','Save'),async event=>{
          event.currentTarget.disabled=true;
          try { await save(body); $('panel').close(); }
          catch(error) { notice.textContent=error.message; preview.hidden=true; }
        },{class:'primary'}));
      preview.hidden=false;
      preview.querySelector('button').focus();
      notice.textContent='';
    } catch(error) { notice.textContent=error.message; }
  }},
  h('div',{class:'fields'},controls.map(([spec,input])=>h('label',{class:spec.type==='textarea'?'wide':spec.type==='checkbox'?'wide check':''},spec.label,input))),
  actions,notice,preview,tail);
  form.addEventListener('input',()=>{preview.hidden=true;});
  openPanel(title,t,form);
}
