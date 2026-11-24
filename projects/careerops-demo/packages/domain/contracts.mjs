export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function check(ok, message, status = 422) {
  if (!ok) throw new ApiError(status, message);
}
export function object(value) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value;
}
export function string(value, max = 500) {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'Invalid text');
  return value.trim();
}
const date = value => {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Expected ISO date');
  const stamp = new Date(value + 'T00:00:00Z');
  check(!Number.isNaN(stamp.valueOf()) && stamp.toISOString().slice(0,10) === value, 'Invalid calendar date');
  return value;
};
const time = value => {
  check(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), 'Expected HH:mm');
  return value;
};
const source = value => {
  const s = string(value, 2048);
  check(URL.canParse(s) && ['https:', 'http:'].includes(new URL(s).protocol), 'Expected source URL');
  return s;
};
const textList = value => {
  check(Array.isArray(value) && value.length <= 100, 'Expected list');
  return value.map(item => string(item));
};
const uint = value => {
  check(Number.isSafeInteger(value) && value >= 0, 'Expected nonnegative integer');
  return value;
};
const evidence = {source_url:source, verified_on:date};
const oneOf = choices => value => {
  check(choices.includes(value),'Unknown status');
  return value;
};
function list(value, item) {
  check(Array.isArray(value) && value.length <= 50,'Expected list with at most 50 entries');
  return value.map(item);
}
const relatedFields = {
  aliases:value=>list(value,stringValue=>string(stringValue)),
  requirements:value=>list(value,row=>fieldsFor({required:['kind','criterion'],fields:{kind:oneOf(['required','preferred']),criterion:string}},row,false)),
  sources:value=>list(value,row=>fieldsFor({required:['url'],fields:{url:source,verified_on:date,evidence:string}},row,false))
};
export const relationFields = Object.keys(relatedFields);
export const resources = {
  companies: {required:['name'], fields:{name:string, size_class:string, institution_type:string, ...evidence,aliases:relatedFields.aliases}},
  job_postings: {required:['company_id','round_key','role_code','title'], fields:{
    company_id:string, round_key:string, role_code:string, title:string, responsibilities:string, location:string,
    headcount:uint, compensation:string, employment_type:string, deadline_date:date, deadline_time:time, previous_id:string,
    posting_number:string, open_date:date, content_hash:value=>{
      check(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'Expected SHA-256');
      return value;
    },
    review_status:oneOf(['new','unreviewed','needs_verification','reviewed','paused']),
    posting_status:oneOf(['upcoming','open','closed','changed','cancelled','unverified']),
    requirements:relatedFields.requirements,sources:relatedFields.sources
  }},
  schedules: {required:['posting_id','kind','title'], fields:{
    posting_id:string, kind:string, title:string, start_date:date, end_date:date, start_time:time,
    end_time:time, location:string, condition_note:string, ...evidence,
    status:oneOf(['planned','conditional','completed','cancelled']), certainty:oneOf(['planned','confirmed','unverified']),
    predecessor_id:string, arrival_time:time, admission_deadline:time, preparation:string, notes:string
  }}
};
export function fieldsFor(schema, data, partial) {
  object(data);
  const values = {};
  for (const [key, value] of Object.entries(data)) {
    check(Object.hasOwn(schema.fields,key), 'Unknown field: ' + key);
    const optional = !schema.required.includes(key) && !['status','certainty','review_status','posting_status',...relationFields].includes(key);
    values[key] = value === null && optional ? null : schema.fields[key](value);
  }
  if (!partial) for (const key of schema.required) check(Object.hasOwn(values,key), 'Missing field: ' + key);
  if (partial) check(Object.keys(values).length > 0, 'Empty patch');
  return values;
}
const profileSchema = {required:[],fields:{
  degree:string, major:string, research:textList, industry_years:uint, technologies:textList,
  languages:textList, certifications:textList, preferred_regions:textList, salary_goal:string,
  job_priorities:textList, exclusion_rules:textList
}};
export const profileDetails = data => fieldsFor(profileSchema,data,false);
export function versionNumber(value) {
  check(Number.isSafeInteger(value) && value >= 1, 'Expected positive record version');
  return value;
}
