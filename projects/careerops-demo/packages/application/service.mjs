import { randomUUID } from 'node:crypto';
import { ApiError, check, fieldsFor, profileDetails, relationFields, resources, versionNumber } from '../domain/contracts.mjs';
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
  audit(actor,type,id,before,after,correlationId=randomUUID()) {
    this.db.prepare('INSERT INTO change_logs(entity,record_id,actor,before_json,after_json,changed_at,correlation_id) VALUES (?,?,?,?,?,?,?)')
      .run(type,id,actor,before ? JSON.stringify(before) : null,JSON.stringify(after),new Date().toISOString(),correlationId);
  }
  checkLinks(actor,type,row,id) {
    if (type === 'job_postings') {
      this.read(actor,'companies',row.company_id);
      check(!row.open_date || !row.deadline_date || row.open_date<=row.deadline_date,'Opening is after deadline');
      const seen = new Set([id]);
      let previous = row.previous_id;
      while (previous) {
        check(!seen.has(previous),'Circular posting relationship',409);
        seen.add(previous);
        const related = this.read(actor,type,previous);
        check(related.company_id === row.company_id,'Previous posting must belong to the same company');
        previous = related.previous_id;
      }
      if (id) {
        check(!this.db.prepare('SELECT 1 FROM job_postings WHERE previous_id=? AND company_id<>? AND deleted_at IS NULL').get(id,row.company_id),
          'Subsequent posting would be disconnected',409);
      }
    }
    if (type === 'schedules') {
      this.read(actor,'job_postings',row.posting_id);
      const seen = new Set([id]);
      let predecessor = row.predecessor_id;
      while (predecessor) {
        check(!seen.has(predecessor),'Circular schedule dependency',409);
        seen.add(predecessor);
        const related = this.read(actor,type,predecessor);
        check(related.posting_id === row.posting_id,'Predecessor must belong to the same posting');
        predecessor = related.predecessor_id;
      }
      if (id) {
        check(!this.db.prepare('SELECT 1 FROM schedules WHERE predecessor_id=? AND posting_id<>? AND deleted_at IS NULL').get(id,row.posting_id),
          'Dependent schedule would be disconnected',409);
      }
    }
  }
  relations(type,id) {
    if (type === 'companies') return {aliases:this.db.prepare('SELECT alias FROM company_aliases WHERE company_id=? ORDER BY alias').all(id).map(row=>row.alias)};
    if (type === 'job_postings') return {
      requirements:this.db.prepare('SELECT kind,criterion FROM job_requirements WHERE posting_id=? ORDER BY kind,criterion').all(id),
      sources:this.db.prepare('SELECT url,verified_on,evidence FROM job_sources WHERE posting_id=? ORDER BY url').all(id)
    };
    return {};
  }
  writeRelations(id,changes) {
    if (changes.aliases) {
      this.db.prepare('DELETE FROM company_aliases WHERE company_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO company_aliases VALUES (?,?)');
      for (const alias of changes.aliases) insert.run(alias,id);
    }
    if (changes.requirements) {
      this.db.prepare('DELETE FROM job_requirements WHERE posting_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO job_requirements VALUES (?,?,?,?)');
      for (const {kind,criterion} of changes.requirements) insert.run(randomUUID(),id,kind,criterion);
    }
    if (changes.sources) {
      this.db.prepare('DELETE FROM job_sources WHERE posting_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO job_sources VALUES (?,?,?,?,?)');
      for (const {url,verified_on,evidence} of changes.sources) insert.run(randomUUID(),id,url,verified_on ?? null,evidence ?? null);
    }
  }
  mutate(actor,type,id,version,patch,correlationId) {
    this.authorize(actor,true);
    const schema = this.resource(type);
    const creating = id === undefined;
    const removing = patch === undefined;
    if (!creating) versionNumber(version);
    const values = removing ? {deleted_at:new Date().toISOString()} : fieldsFor(schema,patch,!creating);
    const relations = {};
    for (const key of relationFields) {
      if (!Object.hasOwn(values,key)) continue;
      relations[key] = values[key];
      delete values[key];
    }
    if (type === 'job_postings') values.updated_at = new Date().toISOString();
    const keys = Object.keys(values);
    try {
      return transaction(this.db, () => {
        const before = creating ? null : this.read(actor,type,id);
        if (before) check(before.version === version,'Record changed',409);
        const previousRelations = this.relations(type,id ?? '');
        if (!removing) this.checkLinks(actor,type,{...before,...values},id);
        if (removing) {
          const child = {companies:['job_postings','company_id'],job_postings:['schedules','posting_id']}[type];
          if (child) check(!this.db.prepare('SELECT 1 FROM '+child[0]+' WHERE '+child[1]+'=? AND deleted_at IS NULL LIMIT 1').get(id),'Active child records exist',409);
          if (type === 'job_postings') check(!this.db.prepare('SELECT 1 FROM applications WHERE posting_id=? AND deleted_at IS NULL LIMIT 1').get(id),'Active application exists',409);
          if (type === 'schedules') check(!this.db.prepare('SELECT 1 FROM schedules WHERE predecessor_id=? AND deleted_at IS NULL').get(id),'Dependent schedule exists',409);
          if (type === 'job_postings') check(!this.db.prepare('SELECT 1 FROM job_postings WHERE previous_id=? AND deleted_at IS NULL').get(id),'Subsequent posting exists',409);
        }
        if (creating) {
          id = randomUUID();
          this.db.prepare('INSERT INTO '+type+' (id,'+keys.join(',')+') VALUES (?,'+keys.map(()=>'?').join(',')+')')
            .run(id,...Object.values(values));
        } else {
          const assignments = [...keys.map(k=>k+'=?'),'version=version+1'];
          this.db.prepare('UPDATE '+type+' SET '+assignments.join(',')+' WHERE id=?').run(...Object.values(values),id);
        }
        this.writeRelations(id,relations);
        const after = this.db.prepare('SELECT * FROM '+type+' WHERE id=?').get(id);
        this.audit(actor,type,id,before ? {...before,...previousRelations} : null,{...after,...this.relations(type,id)},correlationId);
        return after;
      });
    } catch (error) {
      if ([1555,2067].includes(error.errcode)) throw new ApiError(409,'Duplicate record');
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
