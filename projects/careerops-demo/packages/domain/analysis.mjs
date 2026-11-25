import { check, object, string } from './contracts.mjs';
import { postingLifecycle } from './workflow.mjs';

export const criteria = ['direct_fit','skills','research','competitiveness','career_value','conditions'];
export const initialWeights = Object.freeze(Object.fromEntries(criteria.map((key,index)=>[key,[30,20,15,10,15,10][index]])));
export const ruleVersion = '2026-11-25.2';
export const ruleKeys = ['experience','degree','major','license','language','coding','deadline','round','exclusion'];
const suffixes = {'industrial_cfd':'1','physics_ai':'2','manufacturing_simulation':'3'};

export function weightsOf(value) {
  object(value);
  check(Object.keys(value).length===criteria.length && criteria.every(key=>Number.isInteger(value[key]) && value[key]>=0 && value[key]<=100 &&
    Object.hasOwn(value,key)) && criteria.reduce((sum,key)=>sum+value[key],0)===100,'Weights must sum to 100');
  return Object.fromEntries(criteria.map(key=>[key,value[key]]));
}

export function evaluateFit(input,weights) {
  object(input);
  for (const key of Object.keys(input)) check(criteria.includes(key),'Unknown evaluation criterion');
  const components = criteria.map(criterion=>{
    const value = input[criterion];
    if (value === null || value === undefined) return {criterion,score:null,weight:weights[criterion],evidence:null,uncertainty:'missing'};
    object(value);
    check(typeof value.score==='number' && Number.isFinite(value.score) && value.score>=0 && value.score<=100,'Expected score from 0 to 100');
    return {criterion,score:value.score,weight:weights[criterion],evidence:string(value.evidence),
      uncertainty:value.uncertainty ? string(value.uncertainty) : null};
  });
  const coverage = components.reduce((sum,item)=>sum+(item.score===null?0:item.weight),0);
  const earned = components.reduce((sum,item)=>sum+(item.score===null?0:item.score*item.weight),0);
  return {components,coverage,score:coverage===100?Math.round(earned)/100:null};
}

export function classifyCompany(facts={}) {
  const {listed,employees,organization,evidence}=facts;
  if (!evidence) return null;
  if (['public','research'].includes(organization)) return organization;
  if (listed===true || employees>=100) return 'B';
  if (listed===false && employees>=50) return 'C';
  if (listed===false && employees>=1) return 'D';
  return null;
}

function qualification(key,entry,profile) {
  if (!entry || !entry.evidence) return ['UNKNOWN','requirement_unverified',null];
  const {mode,evidence,value}=entry;
  if (mode==='none' || mode==='preferred') return ['PASS',mode,evidence];
  if (mode!=='required') return ['UNKNOWN','requirement_unverified',evidence];
  let met = null;
  if (key==='experience' && Number.isFinite(profile.industry_years)) met=profile.industry_years>=value;
  if (key==='degree') {
    const degrees=['high_school','associate','bachelor','master','doctorate'];
    const actual=degrees.indexOf(profile.degree);
    if (actual!==-1) met=actual>=degrees.indexOf(value);
  }
  if (key==='major' && profile.major) met=value.some(major=>normalizeText(major)===normalizeText(profile.major));
  if (key==='license' && Array.isArray(profile.certifications)) met=profile.certifications.some(item=>normalizeText(item)===normalizeText(value));
  if (key==='language') {
    const levels=['NL','NM','NH','IL','IM1','IM2','IM3','IH','AL'];
    const expected=/^OPIC\s+(\S+)$/i.exec(value)?.[1]?.toUpperCase();
    const ranks=(profile.languages ?? []).map(item=>levels.indexOf(/^OPIC\s+(\S+)$/i.exec(item)?.[1]?.toUpperCase())).filter(item=>item>=0);
    if (ranks.length && levels.includes(expected)) met=Math.max(...ranks)>=levels.indexOf(expected);
  }
  return [met===null?'UNKNOWN':met?'PASS':'FAIL',met===null?'profile_unverified':met?'requirement_met':'requirement_unmet',evidence];
}
function codingRule(facts) {
  if (!facts?.evidence || !['algorithm','other','none'].includes(facts.type)) return ['UNKNOWN','coding_type_unverified',facts?.evidence ?? null];
  return facts.type==='algorithm' ? ['FAIL','algorithm_test_confirmed',facts.evidence] : ['PASS','no_confirmed_algorithm_test',facts.evidence];
}
function deadlineRule(posting,today,seoulTime) {
  if (postingLifecycle(posting,today,seoulTime)==='closed') return ['FAIL','posting_closed',
    ['cancelled','closed'].includes(posting.posting_status)?posting.posting_status:[posting.deadline_date,posting.deadline_time].filter(Boolean).join(' ')];
  if (!posting.deadline_date) return ['UNKNOWN','deadline_unverified',null];
  if (posting.deadline_date===today && !posting.deadline_time) return ['UNKNOWN','closing_time_unverified',posting.deadline_date];
  return ['PASS','before_confirmed_deadline',posting.deadline_date];
}
export function assessRules({posting,application,exclusion,facts,profile,today,seoulTime,institutionType}) {
  const classify=classifyCompany(facts.company);
  const size=['B','C','D'].includes(classify)?classify:null;
  const institution= ['company','public','research'].includes(facts.company?.organization)?facts.company.organization:
    ['public','research'].includes(classify)?classify:institutionType??null;
  const direct=facts.role?.direct === true && Object.hasOwn(suffixes,facts.role.track) && Boolean(facts.role.evidence);
  const userPlanned=['planned','secondary'].includes(application?.intent) && application.stage==='not_submitted';
  const alreadyApplied=application && (application.stage!=='not_submitted' || ['declined','withdrawn'].includes(application.intent));
  const rows=[
    ...ruleKeys.slice(0,5).map(key=>qualification(key,facts.qualifications?.[key],profile)),
    codingRule(facts.coding),deadlineRule(posting,today,seoulTime),
    alreadyApplied?['FAIL','round_already_handled',application.id]:['PASS','round_available',posting.round_key],
    exclusion?['FAIL','excluded_by_user',exclusion.reason]:['PASS','no_scoped_exclusion',null]
  ];
  const rules=ruleKeys.map((id,index)=>{
    const [status,reason,evidence]=rows[index];
    return {id,status,reason,evidence,version:ruleVersion};
  });
  const qualifications=rules.slice(0,5);
  const eligibility=qualifications.some(item=>item.status==='FAIL')?'FAIL':qualifications.some(item=>item.status==='UNKNOWN')?'UNKNOWN':'PASS';
  const exclusionReasons=rules.slice(5).filter(item=>item.status==='FAIL').map(item=>item.reason);
  const roleFit=(direct || facts.role?.fit===true) && Boolean(facts.role?.evidence);
  const sizeAllowed=size==='B' || size==='C' || (size==='D' && direct);
  const recommendation=exclusionReasons.length || eligibility==='FAIL'?'excluded':
    eligibility==='UNKNOWN'||rows.slice(5,7).some(([status])=>status==='UNKNOWN')?'review':
    userPlanned?'user_planned':(sizeAllowed||['research','public'].includes(institution)) && roleFit?'candidate':'review';
  const sizeLabel = size && /^[BCD]$/.test(size) && direct ? size+'-'+suffixes[facts.role.track] : size;
  return {eligibility,recommendation,exclusionReasons,applicationStage:application?.stage??null,institution,size,sizeLabel,
    postingLifecycle:postingLifecycle(posting,today,seoulTime),userGrade:userPlanned?'A':null,rules};
}

export const normalizeText = text=>String(text ?? '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
export function normalizeSource(url) {
  const value = new URL(url);
  check(['https:','http:'].includes(value.protocol) && !value.username && !value.password,'Expected an HTTP source URL');
  value.hash='';
  for (const key of [...value.searchParams.keys()]) if (/^(utm_.+|gclid|fbclid|msclkid)$/i.test(key)) value.searchParams.delete(key);
  value.searchParams.sort();
  return value.href;
}

export function identifyPosting(input,rows,sources) {
  const title=normalizeText(input.title);
  const exact=rows.filter(row=>normalizeText(row.round_key)===normalizeText(input.round_key) && normalizeText(row.role_code)===normalizeText(input.role_code));
  if (exact.length>1) return {decision:'review',ids:exact.map(row=>row.id)};
  if (exact.length===1) return {decision:'merge',id:exact[0].id};
  const requested = new Set(sources.map(normalizeSource));
  const candidates=rows.filter(row=>{
    const sameTitle=normalizeText(row.title)===title;
    const sameRole=normalizeText(row.role_code)===normalizeText(input.role_code) || sameTitle;
    const sameNumber=input.posting_number && row.posting_number && normalizeText(input.posting_number)===normalizeText(row.posting_number);
    const sameUrl=row.urls.some(url=>requested.has(normalizeSource(url)));
    const sameDates=input.open_date && input.deadline_date && input.open_date===row.open_date && input.deadline_date===row.deadline_date;
    const sameHash=input.content_hash && input.content_hash===row.content_hash;
    if (sameNumber && sameRole) return true;
    return (sameRole && (sameUrl || sameDates || sameHash));
  });
  return candidates.length?{decision:'review',ids:candidates.map(row=>row.id)}:{decision:'create'};
}
