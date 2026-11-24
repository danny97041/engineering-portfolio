import { check, resources } from '../domain/contracts.mjs';

// Only schema-owned identifiers enter the SQL text. All deployment and user values are bound.
export function catalogQuery(type,id,realm,stage) {
  check(Object.hasOwn(resources,type),'Unknown resource',404);
  const order = type === 'schedules' ? 'start_date, start_time, id' : 'id';
  const terms = ['deleted_at IS NULL','EXISTS (SELECT 1 FROM instance_binding WHERE singleton=1 AND realm=? AND stage=?)'];
  const args = [realm,stage];
  if (id !== undefined) { terms.push('id=?'); args.push(id); }
  return {sql:'SELECT * FROM '+type+' WHERE '+terms.join(' AND ')+' ORDER BY '+order,args};
}
export function catalogResult(rows,id) {
  if (id === undefined) return rows;
  check(rows.length === 1,'Record not found',404);
  return rows[0];
}
