import { button, h, table, valueText } from './dom.mjs';
import { openPanel } from './forms.mjs';

const labels = {
  direct_fit:['직무 직접 적합성','Direct role fit'],skills:['기술 스택','Technical skills'],
  research:['연구 연결성','Research relevance'],competitiveness:['지원 경쟁력','Competitiveness'],
  career_value:['중장기 경력 가치','Career value'],conditions:['지역·근무조건','Location and conditions'],
  experience:['필수 경력','Required experience'],degree:['필수 학위','Required degree'],major:['필수 전공','Required major'],
  license:['필수 자격','Required certification'],language:['어학 요건','Language requirement'],coding:['코딩테스트','Coding test'],
  deadline:['접수 마감','Deadline'],round:['회차 중복','Previously handled round'],exclusion:['제외 설정','Exclusions'],
  PASS:['충족','Pass'],FAIL:['제외','Fail'],UNKNOWN:['검토 필요','Unknown'],
  candidate:['추천 후보','Candidate'],review:['추가 검토','Review'],excluded:['제외','Excluded'],user_planned:['사용자 지원예정','User-planned'],
  requirement_unverified:['공고 확인 필요','Requirement unverified'],profile_unverified:['보유 조건 확인 필요','Profile unverified'],
  requirement_met:['요구 충족','Requirement met'],requirement_unmet:['필수 조건 미충족','Requirement unmet'],
  none:['요건 없음','No requirement'],preferred:['우대 요건','Preferred qualification'],
  coding_type_unverified:['유형 미확인','Screening type unverified'],algorithm_test_confirmed:['알고리즘 시험 확인','Algorithm test confirmed'],
  no_confirmed_algorithm_test:['알고리즘 시험 없음','No algorithm test'],posting_closed:['접수 종료','Posting closed'],
  deadline_unverified:['마감 미확인','Deadline unverified'],closing_time_unverified:['당일 마감 시각 미확인','Closing time unverified'],
  before_confirmed_deadline:['마감 전','Before deadline'],round_already_handled:['기존 지원·미지원·포기 기록','Existing application decision'],
  round_available:['신규 검토 가능 회차','Round available'],excluded_by_user:['사용자 제외 범위','User exclusion'],
  no_scoped_exclusion:['해당 제외 설정 없음','No matching exclusion']
};
export function analysisLabel(key,t) { return labels[key] ? t(...labels[key]) : valueText(key); }
function renderMsg(status,text,error=false) {
  status.textContent=text;
  status.classList.toggle('error',error);
}
export function jsonEditor({t,title,description,data,save,placeholder}) {
  const input=h('textarea',{rows:13,value:JSON.stringify(data,null,2),placeholder});
  const status=h('p',{role:'status'});
  const form=h('form',{class:'stack',onsubmit:async event=>{
    event.preventDefault();
    const submit=form.querySelector('button');
    submit.disabled=true;
    try {
      const result=await save(JSON.parse(input.value));
      renderMsg(status,result ?? t('저장했습니다.','Saved.'));
    } catch(error) { renderMsg(status,error.message,true); }
    finally { submit.disabled=false; }
  }},h('label',{class:'fields'},description,input),h('div',{class:'actions'},h('button',{class:'primary',type:'submit'},t('적용','Apply'))),status);
  openPanel(title,t,form);
}

export function reviewPanel({job,t,api,load,review}) {
  const fields=Object.keys(review.config.weights);
  const assessment=review.assessment;
  const detail=h('div',{class:'stack'});
  const refresh=async()=>reviewPanel({job,t,api,load,review:await api('analysis/'+job.id)});
  const editFacts=()=>jsonEditor({
    t,title:t('근거 입력','Edit rule evidence'),data:review.facts,
    description:t('공식 공고에서 확인한 구조화 근거 JSON','Structured JSON evidence from the official posting'),
    save:async facts=>{
      await api('analysis_facts/'+job.id,'PUT',{version:review.versions.factVersion,postingVersion:review.versions.postingVersion,facts});
      await load();await refresh();
    }
  });
  const editScore=()=>{
    const controls=fields.map(key=>{
      const part=assessment?.components.find(item=>item.criterion===key);
      const score=h('input',{type:'number',min:0,max:100,step:'0.1',value:part?.score ?? ''});
      const evidence=h('input',{type:'text',maxlength:500,value:part?.evidence ?? ''});
      const uncertainty=h('input',{type:'text',maxlength:500,value:part?.uncertainty==='missing'?'':part?.uncertainty ?? ''});
      const label=analysisLabel(key,t);
      return {key,score,evidence,uncertainty,body:h('fieldset',{class:'card'},
        h('legend',{},label+' · '+review.config.weights[key]+'%'),h('div',{class:'fields'},
          h('label',{},t('점수 (0–100)','Score (0–100)'),score),h('label',{},t('근거','Evidence'),evidence),
          h('label',{},t('불확실성','Uncertainty'),uncertainty)))};
    });
    const status=h('p',{role:'status'});
    openPanel(t('적합도 입력','Record a fit assessment'),t,h('form',{class:'stack',onsubmit:async event=>{
      event.preventDefault();
      const submit=event.currentTarget.querySelector('button');
      submit.disabled=true;
      try {
        const components=Object.fromEntries(controls.filter(item=>item.score.value!=='').map(item=>[item.key,
          {score:Number(item.score.value),evidence:item.evidence.value,uncertainty:item.uncertainty.value}]));
        await api('assessments/'+job.id,'POST',{versions:review.versions,components});
        await load();await refresh();
      } catch(error) { renderMsg(status,error.message,true); }
      finally { submit.disabled=false; }
    }},h('p',{class:'muted'},t('근거가 없는 점수는 비워 두세요.','Leave scores blank when evidence is missing.')),
    controls.map(item=>item.body),h('button',{class:'primary',type:'submit'},t('평가 저장','Save assessment')),status));
  };
  const dimensions=[t('항목','Criterion'),t('점수','Score'),t('근거','Evidence'),t('불확실성','Uncertainty')];
  detail.append(h('div',{class:'actions'},h('span',{class:'pill'},analysisLabel(review.eligibility,t)),
    h('span',{class:'pill'},analysisLabel(review.recommendation,t)),h('span',{class:'pill'},[review.userGrade,review.sizeLabel].filter(Boolean).join(' / ') || t('규모 미확인','Size unknown'))),
  table([t('규칙','Rule'),t('결과','Status'),t('이유','Reason'),t('출처·근거','Source or evidence')],
    review.rules.map(row=>[analysisLabel(row.id,t),analysisLabel(row.status,t),analysisLabel(row.reason,t),
      ['round_available','round_already_handled'].includes(row.reason)?'—':valueText(row.evidence)]),t('자격 판정','Eligibility decisions'),t('자료 없음','No data')),
  h('div',{class:'actions'},button(t('근거 입력','Edit rule evidence'),editFacts),button(t('적합도 입력','Record fit'),editScore,{class:'primary'})),
  h('p',{class:'muted'},t('규칙 버전','Rule version')+' · '+review.ruleVersion));
  if (review.factsStale) detail.prepend(h('p',{class:'error'},t('공고가 수정돼 공식 근거를 다시 확인해야 합니다.','The posting has changed. Reconfirm the official evidence.')));
  if (assessment) {
    detail.append(h('section',{class:'card stack'},h('h3',{},t('최근 적합도','Latest fit')),
      h('p',{},valueText(assessment.score)+' / 100 · '+t('가중치 충족률','Weight coverage')+' '+valueText(assessment.coverage)+'%'),
      assessment.stale ? h('p',{class:'error'},t('입력 기준이 바뀐 이전 평가입니다.','Historical assessment. Inputs have changed.')) : null,
      table(dimensions,assessment.components.map(item=>[analysisLabel(item.criterion,t),valueText(item.score),valueText(item.evidence),valueText(item.uncertainty)]),
        t('항목별 점수','Criterion scores'),t('평가 없음','No assessments'))));
  }
  if (review.facts.compensation) {
    const c=review.facts.compensation;
    detail.append(h('section',{class:'card'},h('h3',{},t('보상 근거','Compensation evidence')),
      h('p',{},t('보장','Base')+' '+valueText(c.base)+' · '+t('변동','Variable')+' '+valueText(c.variable)+' · '+valueText(c.currency)+' · '+valueText(c.year)),
      h('p',{class:'muted'},c.evidence)));
  }
  openPanel(job.title+' · '+t('분석','Analysis'),t,detail);
}

function breakdown(title,entries,t) {
  return h('section',{class:'card'},h('h2',{},title),
    table([t('항목','Value'),t('건수','Count')],entries,t('분포','Distribution'),t('집계 자료가 없습니다.','No observations.')));
}
export function analytics(stats,t) {
  if (!stats) return h('p',{class:'card muted'},t('집계 자료가 없습니다.','No observations.'));
  const pct = value=>value===null?'—':new Intl.NumberFormat(t('ko-KR','en-US'),{style:'percent',maximumFractionDigits:1}).format(value);
  const num = value=>value===null?'—':Number(value).toFixed(1);
  const entries = obj=>Object.entries(obj).map(([key,count])=>[key==='unknown'?t('미확인','Unknown'):analysisLabel(key,t),String(count)]);
  const limits=t('전체 공고','Postings')+' '+stats.denominators.postings+' · '+t('기록된 지원','Application records')+' '+stats.denominators.applications+
    ' · '+t('제출 확인','Confirmed submissions')+' '+stats.denominators.submitted+' · '+t('유효 총점','Current complete fit scores')+' '+stats.denominators.scored;
  return h('div',{class:'stack'},
    h('section',{class:'card'},h('h2',{},t('집계 범위','Coverage')),h('p',{},limits),
      h('p',{class:'muted'},t('첫 지원 이벤트','First application event')+' · '+valueText(stats.period.first)+' / '+t('집계 시각','As of')+' · '+stats.period.through),
      h('p',{},t('현재 합격·입사 / 제출','Current offers or hires / submissions')+' · '+pct(stats.offerShare)),
      h('p',{},t('제출~결과 평균 일수','Mean submission-to-terminal days')+' · '+num(stats.averageTerminalDays)+' ('+stats.terminalSamples+')')),
    h('div',{class:'grid'},
      breakdown(t('직무코드','Role codes'),entries(stats.roles),t),breakdown(t('지역','Regions'),entries(stats.regions),t),
      breakdown(t('기업 규모','Organization size'),entries(stats.sizes),t),breakdown(t('지원 전형','Application stages'),entries(stats.stages),t),
      breakdown(t('월별 제출','Monthly submissions'),entries(stats.monthlySubmissions),t),breakdown(t('자격 판정','Eligibility'),entries(stats.eligibility),t),
      breakdown(t('적합도 구간','Fit score bands'),entries(stats.scores),t),breakdown(t('필수 요건','Required qualification terms'),
        entries(stats.requirements).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,12),t),
      breakdown(t('수집 결과','Scan outcomes'),stats.scanOutcomes.map(row=>[row.outcome,String(row.count)]),t),
      breakdown(t('공고 등록·중복 처리','Intake decisions'),stats.intakeOutcomes.map(row=>[row.status,String(row.count)]),t),
      breakdown(t('스캔 추이 · UTC','Scan trend · UTC'),stats.scanTrend.map(row=>[row.utc_date,String(row.count)]),t)),
    h('section',{class:'card'},h('h2',{},t('로컬 처리 계측','Measured local processing')),
      table([t('지표','Metric'),t('표본','Samples'),t('합계','Total'),t('평균','Mean'),t('단위','Unit')],
        stats.observed.map(row=>[row.metric,String(row.samples),num(row.total),num(row.mean),row.unit]),t('계측','Measurements'),t('계측 자료가 없습니다.','No measurements.'))));
}

export async function showIntake({t,api,load}) {
  const queue=await api('intake');
  openPanel(t('중복 검토 큐','Duplicate review queue'),t,h('div',{class:'stack'},
    table([t('접수 시각','Received'),t('기업','Company'),t('공고','Posting'),t('유사 후보 수','Similar postings')],
      queue.map(row=>[row.createdAt,row.company,row.posting.title,String(row.ids.length)]),
      t('검토 큐','Review queue'),t('검토 항목이 없습니다.','No queued items.')),
    button(t('공고 수집 등록','Register intake'),()=>jsonEditor({
      t,title:t('공고 수집 등록','Register posting intake'),
      description:t('기업명 또는 별칭, 요청 키, 구조화된 공고를 입력하세요.','Enter a company name or alias, a request key, and a structured posting.'),
      data:{key:'',company:'',posting:{title:'',round_key:'',role_code:'',sources:[]}},
      save:async body=>{
        const result=await api('intake','POST',body);
        await load();
        return ({create:t('공고를 등록했습니다.','Posting created.'),merge:t('기존 공고에 병합했습니다.','Merged into the existing posting.'),
          review:t('중복 검토 큐에 보냈습니다.','Sent to the duplicate review queue.')})[result.decision];
      }
    }),{class:'primary'})));
}
