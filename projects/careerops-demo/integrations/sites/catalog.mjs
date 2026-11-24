import { catalogQuery, catalogResult } from '../../packages/database/catalog.mjs';

// Server-side persistence adapter. The calling Site must authorize the visitor first.
// The caller supplies the realm and stage from server configuration at construction.
export function d1Catalog(binding,realm,stage) {
  return {async read(type,id) {
    const {sql,args} = catalogQuery(type,id,realm,stage);
    const response = await binding.prepare(sql).bind(...args).all();
    if (!response.success) throw Error('D1 catalog read failed');
    return catalogResult(response.results,id);
  }};
}
