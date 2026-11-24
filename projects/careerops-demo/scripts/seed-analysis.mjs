import { fileURLToPath } from 'node:url';
import { openStore, transaction } from '../packages/database/local.mjs';
import { CareerService } from '../packages/application/service.mjs';
import { recordAssessment, updateFacts } from '../packages/application/analysis.mjs';
import { seed } from '../fixtures/synthetic/seed.mjs';
import { addDays, seoulDate } from '../packages/domain/workflow.mjs';

const db=openStore(fileURLToPath(new URL('../.state/',import.meta.url)),'demo','development');
const service=new CareerService(db);
const criteria=['direct_fit','skills','research','competitiveness','career_value','conditions'];
const tracks=['industrial_cfd','physics_ai','manufacturing_simulation'];
try {
  const result=transaction(db,()=>{
    seed(db);
    const postings=db.prepare(`SELECT * FROM job_postings WHERE round_key='fixture-round-1'
      AND role_code IN ('R0','R1','R2') AND deleted_at IS NULL ORDER BY role_code`).all();
    if (postings.length!==3) throw new Error('The three demo fixture postings are required');
    let count=0;
    for (const [index,posting] of postings.entries()) {
      if (db.prepare('SELECT 1 FROM analysis_facts WHERE posting_id=?').get(posting.id) ||
          db.prepare('SELECT 1 FROM assessments WHERE posting_id=?').get(posting.id)) continue;
      if (!posting.deadline_date && posting.version===1) service.mutate('owner','job_postings',posting.id,posting.version,
        {deadline_date:addDays(seoulDate(),7+index*3)});
      const note='Synthetic fixture evidence for the portfolio demo.';
      const version=service.read('owner','job_postings',posting.id).version;
      const result=updateFacts(service,'owner',posting.id,{version:0,postingVersion:version,facts:{
        company:{listed:false,employees:[110,67,32][index],evidence:note},
        role:{track:tracks[index],direct:true,evidence:note},
        coding:{type:index===2?'unknown':'none',evidence:note},
        qualifications:Object.fromEntries(['experience','degree','major','license','language'].map(key=>[key,{mode:'none',evidence:note}]))
      }});
      const components=Object.fromEntries(criteria.slice(0,index===2?3:criteria.length).map((key,i)=>[key,{score:72+(index*7+i*3)%22,evidence:note}]));
      recordAssessment(service,'owner',posting.id,{versions:result.versions,components});
      count++;
    }
    return count;
  });
  console.log('Synthetic assessments added: '+result);
} finally {
  db.close();
}
