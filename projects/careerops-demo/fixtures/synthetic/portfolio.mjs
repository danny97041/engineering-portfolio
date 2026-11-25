import { CareerService } from '../../packages/application/service.mjs';
import { transaction } from '../../packages/database/local.mjs';
import { addDays,seoulDate } from '../../packages/domain/workflow.mjs';
import { criteria } from '../../packages/domain/analysis.mjs';
import { recordAssessment,updateFacts,setExclusion } from '../../packages/application/analysis.mjs';
import { changeApplication } from '../../packages/application/workspace.mjs';
import { writeRecord } from '../../packages/application/records.mjs';
import { recordScan } from '../../packages/application/scans.mjs';

const roles=[
  ['industrial_cfd','산업 CFD','Industrial CFD'],['physics_ai','Physics-AI','Physics-AI'],
  ['digital_twin','디지털 트윈','Digital twin'],['manufacturing_simulation','제조 시뮬레이션','Manufacturing simulation'],
  ['ai_agent','AI 에이전트','AI agent']
];
const evidence='Synthetic evidence for the CareerOps portfolio demonstration.';
export function seedPortfolio(db,today=seoulDate()){
  const service=new CareerService(db), actor='owner';
  if(service.binding.realm!=='demo'||service.binding.stage!=='development') throw Error('Portfolio fixture requires demo development storage');
  return transaction(db,()=>{
    const prior=db.prepare("SELECT value_json FROM app_settings WHERE key='portfolio.v1'").get();
    if(prior) return JSON.parse(prior.value_json);
    if(db.prepare('SELECT 1 FROM companies LIMIT 1').get()) throw Error('Portfolio fixture requires a fresh catalog');
    const add=(type,data)=>service.mutate(actor,type,undefined,undefined,data);
    service.setProfile(actor,1,{degree:'master',major:'Physics',languages:['OPIc IM2']});
    const jobs=[];
    for(let i=0;i<36;i++){
      const num=String(i+1).padStart(2,'0');
      const name='가상 렌즈 연구소 '+num;
      const source='https://example.invalid/portfolio/'+num;
      const company=add('companies',{name,aliases:['Synthetic Lens '+num],source_url:source,verified_on:today});
      for(let round=1;round<=2;round++){
        const [role,ko,en]=roles[(i+round-1)%roles.length];
        const day=1+(i+round)%22;
        const roundKey='2026-sample-'+round;
        const title=ko+' · '+en;
        const posting=add('job_postings',{company_id:company.id,round_key:roundKey,role_code:role,title,
          deadline_date:addDays(today,day),deadline_time:'17:00',open_date:addDays(today,-5),
          location:['서울','부산','대전'][i%3],posting_status:'open',review_status:round===1?'reviewed':'unreviewed',
          sources:[{url:source+'/'+round,verified_on:today,evidence}]});
        jobs.push({posting,name,source:source+'/'+round});
        if(round===1 && i<30){
          const st=i%4===0?'rejected':i%4===2?'interview_planned':null;
          let app=changeApplication(service,actor,undefined,undefined,st?{posting_id:posting.id,stage:'submitted',confirm_submission:true}:{posting_id:posting.id,intent:i%4===1?'planned':'secondary'});
          if(st) app=changeApplication(service,actor,app.id,app.version,{stage:st});
        }
        if(round===1 && i<24){
          const facts=updateFacts(service,actor,posting.id,{version:0,postingVersion:posting.version,facts:{
            company:{listed:false,employees:[32,55,110][i%3],evidence},
            role:{track:['industrial_cfd','physics_ai','manufacturing_simulation'].includes(role)?role:'other',direct:i%5!==1,evidence},coding:{type:i%7===0?'unknown':'none',evidence},
            qualifications:{language:i%6===0?{mode:'required',value:'OPIc IH',evidence}:{mode:'none',evidence}}
          }});
          const components=Object.fromEntries(criteria.slice(0,i%6===0?3:6).map((key,j)=>[key,{score:63+(i*7+j*3)%36,evidence}]));
          recordAssessment(service,actor,posting.id,{versions:facts.versions,components});
        }
        if(round===1 || i<14){
          add('schedules',{posting_id:posting.id,kind:'deadline',title:'접수 마감 · '+num,
            start_date:addDays(today,day),end_time:'17:00'});
        }
        if(round===1 && i<10){
          add('schedules',{posting_id:posting.id,kind:i%3===0?'result':'interview',title:'가상 전형 · '+num,
            start_date:i===3?null:addDays(today,3),start_time:i===3?null:'14:00',end_time:i===3?null:'15:00',
            status:i%3===0?'conditional':'planned',condition_note:i%3===0?'면접 결과 확정 시':null});
        }
      }
    }
    const study=writeRecord(service,actor,{kind:'study',data:{title:'CFD 격자 수렴 검증',topic:'CFD',completed:true}});
    for(let i=0;i<8;i++) writeRecord(service,actor,{kind:'interview',postingId:jobs[i*2].posting.id,
      data:{title:'합성 기술 면접 '+(i+1),format:'패널',expectedQuestions:'격자 독립성을 어떻게 확인합니까?',studyIds:[study.id],completed:i%2===0}});
    setExclusion(service,actor,{scope:'posting',id:jobs.at(-1).posting.id,active:true,reason:'Synthetic owner exclusion'});
    for(let i=0;i<12;i++){
      const code='demo-rule-'+(i+1);
      db.prepare('INSERT INTO rules VALUES (?,?,1,?,1)').run(code,code,JSON.stringify({evidence,label:'Synthetic rule example '+(i+1)}));
    }
    for(let i=0;i<12;i++){
      const {posting,name,source}=jobs.at(-1-i);
      recordScan(service,actor,{key:'fixture-scan-'+i,items:[{
        company:name,source:i===11?'invalid synthetic source':source,observedAt:new Date(Date.now()-1000).toISOString(),
        evidence,expectedVersion:posting.version,posting:{round_key:posting.round_key,role_code:posting.role_code,title:posting.title}
      }]});
    }
    const result={companies:36,postings:72,applications:30,schedules:60,assessments:24,interviews:8,scanRuns:12,rules:12};
    db.prepare("INSERT INTO app_settings VALUES ('portfolio.v1',?,1)").run(JSON.stringify(result));
    return result;
  });
}
