import { randomUUID } from 'node:crypto';
import { ApiError, check, fieldsFor, profileDetails, resources, versionNumber } from '../domain/contracts.mjs';
import { transaction } from '../database/local.mjs';
import { catalogQuery, catalogResult } from '../database/catalog.mjs';

export class CareerService {
  constructor(db) {
    this.db = db;
    this.binding = db.prepare('SELECT realm,stage FROM instance_binding WHERE singleton=1').get();
  }
  authorize(actor, write = false) {
    const user = this.db.prepare('SELECT role FROM users WHERE id=?').get(actor);
    check(user, 'Unknown identity',401);
    check(!write || user.role === 'owner','Write access required',403);
  }
  resource(type) {
    check(Object.hasOwn(resources,type),'Unknown resource',404);
    return resources[type];
  }
  read(actor,type,id) {
    this.authorize(actor);
    const {sql,args} = catalogQuery(type,id,this.binding.realm,this.binding.stage);
    return catalogResult(this.db.prepare(sql).all(...args),id);
  }
  audit(actor,type,id,before,after) {
    this.db.prepare('INSERT INTO change_logs(entity,record_id,actor,before_json,after_json,changed_at) VALUES (?,?,?,?,?,?)')
      .run(type,id,actor,before ? JSON.stringify(before) : null,JSON.stringify(after),new Date().toISOString());
  }
  checkLinks(actor,type,row) {
    if (type === 'job_postings') this.read(actor,'companies',row.company_id);
    if (type === 'schedules') this.read(actor,'job_postings',row.posting_id);
  }
  mutate(actor,type,id,version,patch) {
    this.authorize(actor,true);
    const schema = this.resource(type);
    const creating = id === undefined;
    const removing = patch === undefined;
    if (!creating) versionNumber(version);
    const values = removing ? {deleted_at:new Date().toISOString()} : fieldsFor(schema,patch,!creating);
    const keys = Object.keys(values);
    try {
      return transaction(this.db, () => {
        const before = creating ? null : this.read(actor,type,id);
        if (before) check(before.version === version,'Record changed',409);
        if (!removing) this.checkLinks(actor,type,{...before,...values});
        if (removing) {
          const child = {companies:['job_postings','company_id'],job_postings:['schedules','posting_id']}[type];
          if (child) check(!this.db.prepare('SELECT 1 FROM '+child[0]+' WHERE '+child[1]+'=? AND deleted_at IS NULL LIMIT 1').get(id),'Active child records exist',409);
          if (type === 'job_postings') check(!this.db.prepare('SELECT 1 FROM applications WHERE posting_id=? AND deleted_at IS NULL LIMIT 1').get(id),'Active application exists',409);
        }
        if (creating) {
          id = randomUUID();
          this.db.prepare('INSERT INTO '+type+' (id,'+keys.join(',')+') VALUES (?,'+keys.map(()=>'?').join(',')+')')
            .run(id,...Object.values(values));
        } else {
          this.db.prepare('UPDATE '+type+' SET '+keys.map(k=>k+'=?').join(',')+',version=version+1 WHERE id=?').run(...Object.values(values),id);
        }
        const after = this.db.prepare('SELECT * FROM '+type+' WHERE id=?').get(id);
        this.audit(actor,type,id,before,after);
        return after;
      });
    } catch (error) {
      if (error.errcode === 2067) throw new ApiError(409,'Duplicate record');
      if (error.errcode === 275) throw new ApiError(422,'Invalid field combination');
      throw error;
    }
  }
  profile(actor) {
    this.authorize(actor,true);
    const row = this.db.prepare("SELECT * FROM profiles WHERE user_id='owner'").get();
    return {details:JSON.parse(row.details), version:row.version};
  }
  setProfile(actor,version,input) {
    this.authorize(actor,true);
    versionNumber(version);
    const details = profileDetails(input);
    return transaction(this.db,()=>{
      const before = this.profile(actor);
      check(before.version === version,'Profile changed',409);
      this.db.prepare("UPDATE profiles SET details=?,version=version+1 WHERE user_id='owner'").run(JSON.stringify(details));
      const after = this.profile(actor);
      this.audit(actor,'profiles','owner',before,after);
      return after;
    });
  }
}
