import { check, object, string } from '../domain/contracts.mjs';
import { addDays, applicationInactive } from '../domain/workflow.mjs';
import { workspace } from './workspace.mjs';
import { callTool } from '../mcp/gateway.mjs';
import { fingerprint } from './scans.mjs';
import { transaction } from '../database/local.mjs';

const changes={
  X:{stage:'rejected'},'지원완료':{stage:'submitted',confirm_submission:true},
  'A 일반':{intent:'planned'},'A 후순위':{intent:'secondary'}
};
function selectPosting(w,name){
  const q=name.normalize('NFKC').trim().toLowerCase();
  const names=new Map(w.companies.map(c=>[c.id,[c.name,...w.aliases.filter(a=>a.company_id===c.id).map(a=>a.alias)]]));
  return w.postings.filter(p=>names.get(p.company_id)?.some(n=>[n,n+' / '+p.round_key,n+' / '+p.round_key+' / '+p.role_code]
    .some(v=>v.normalize('NFKC').trim().toLowerCase()===q)));
}
export function command(service,actor,input){
  service.authorize(actor,true);
  object(input);
  if(!input.confirmation) return evaluate(service,actor,input);
  const key='command:'+string(input.confirmation.key,128), digest=fingerprint(input), db=service.db;
  return transaction(db,()=>{
    const old=db.prepare('SELECT digest,result FROM exchange_receipts WHERE key=?').get(key);
    if(old){check(old.digest===digest,'Command key reused with different data',409);return JSON.parse(old.result);}
    const result=evaluate(service,actor,input);
    db.prepare('INSERT INTO exchange_receipts VALUES (?,?,?)').run(key,digest,JSON.stringify(result));
    return result;
  });
}
function evaluate(service,actor,input){
  const {text,confirmation}=object(input);
  const query=string(text,400), w=workspace(service,actor);
  const active=w.schedules.filter(r=>r.bucket==='active');
  if(query==='일정표') return {items:active};
  if(query==='이번 주 일정'){
    const monday=addDays(w.today,-((new Date(w.today+'T00:00:00Z').getUTCDay()+6)%7));
    return {items:active.filter(r=>r.start_date<=addDays(monday,6)&&(r.end_date??r.start_date)>=monday)};
  }
  if(query==='발표일만') return {items:active.filter(r=>r.kind==='result')};
  if(query==='다음 면접') return {items:active.filter(r=>r.kind==='interview').slice(0,1)};
  if(query==='마감 임박') return {items:w.postings.filter(r=>w.focus.deadlines.includes(r.id))};
  if(query==='지원현황') return {items:w.applications.filter(r=>!applicationInactive(r))};
  if(query==='미분석 목록') return callTool(service,actor,'get_unreviewed_jobs',{});
  if(query==='일시 스캔') return {message:'승인된 스캔 결과를 데이터 교환에서 JSON으로 가져올 수 있습니다.'};
  if(query.startsWith('기업 검색 ')){
    const name=query.slice('기업 검색 '.length).toLowerCase();
    return {items:w.companies.filter(c=>[c.name,...w.aliases.filter(a=>a.company_id===c.id).map(a=>a.alias)]
      .some(v=>v.toLowerCase().includes(name)))};
  }
  if(query.startsWith('기업 비교 ')){
    const ids=query.slice('기업 비교 '.length).split(' | ').map(term=>{
      const rows=selectPosting(w,term);
      check(rows.length===1,'Specify an exact company / round / role',409);
      return rows[0].id;
    });
    return callTool(service,actor,'compare_jobs',{ids});
  }
  const pattern=/^(상세분석|기업 일정) (.+)$/.exec(query);
  const mutation=/^(.+) (A 일반|A 후순위|지원완료|X)$/.exec(query);
  check(pattern||mutation,'Unknown command');
  const matches=selectPosting(w,pattern?pattern[2]:mutation[1]);
  check(matches.length,'Posting not found',404);
  if(matches.length>1) return {ambiguous:true,items:matches.map(p=>({id:p.id,company:w.companies.find(c=>c.id===p.company_id).name,round:p.round_key,role:p.role_code}))};
  const posting=matches[0];
  if(pattern) {
    if(pattern[1]==='기업 일정') return {items:active.filter(r=>r.posting_id===posting.id)};
    return callTool(service,actor,'evaluate_eligibility',{id:posting.id});
  }
  const current=w.applications.find(a=>a.posting_id===posting.id);
  const proposed={postingId:posting.id,company:w.companies.find(c=>c.id===posting.company_id).name,title:posting.title,round:posting.round_key,role:posting.role_code,
    postingVersion:posting.version,applicationVersion:current?.version??null,changes:changes[mutation[2]]};
  if(!confirmation) return {confirmationRequired:true,proposed};
  check(confirmation.postingId===posting.id && confirmation.postingVersion===posting.version &&
    confirmation.applicationVersion===proposed.applicationVersion,'Target changed since preview',409);
  const key=string(confirmation.key,128);
  const data=proposed.changes;
  return current?callTool(service,actor,'update_application_status',{id:current.id,version:current.version,data,key}):
    callTool(service,actor,'add_application',{data:{...data,posting_id:posting.id},key});
}
