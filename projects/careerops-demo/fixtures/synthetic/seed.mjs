import { CareerService } from '../../packages/application/service.mjs';
import { transaction } from '../../packages/database/local.mjs';

export function seed(db) {
  const service = new CareerService(db);
  return transaction(db,()=>{
    if (db.prepare('SELECT stage FROM instance_binding').get().stage !== 'development')
      throw Error('Fixture loading requires development storage');
    if (db.prepare("SELECT 1 FROM app_settings WHERE key='fixture.v1'").get()) return 'already seeded';
    if (db.prepare('SELECT 1 FROM companies LIMIT 1').get()) throw Error('Seed requires an empty company catalog');
    const add = (type,data) => service.mutate('owner',type,undefined,undefined,data);
    const companies = ['가상 파랑연구소','가상 초록기술','가상 보라시스템'];
    const roles = ['수치해석','연구 소프트웨어','모델 검증'];
    const postings = companies.map((name,i)=>{
      const company = add('companies',{name,source_url:'https://example.invalid/fixture',verified_on:'2026-11-25'});
      return add('job_postings',{company_id:company.id,round_key:'fixture-round-1',role_code:'R'+i,title:roles[i]});
    });
    const events = [
      {kind:'deadline',title:'접수 마감',start_date:'2026-12-01',end_time:'17:00'},
      {kind:'test',title:'과제 제출 기간',start_date:'2026-12-02',end_date:'2026-12-04'},
      {kind:'interview',title:'면접 시간 미정',start_date:'2026-12-05'},
      {kind:'interview',title:'기술 면접',start_date:'2026-12-07',start_time:'13:30'},
      {kind:'result',title:'조건부 결과 발표',start_date:'2026-12-09',status:'conditional',condition_note:'면접 완료 시'}
    ];
    events.forEach((event,i)=>add('schedules',{posting_id:postings[i % postings.length].id,...event}));
    db.prepare("INSERT INTO app_settings(key,value_json) VALUES ('fixture.v1','true')").run();
    return 'seeded';
  });
}
