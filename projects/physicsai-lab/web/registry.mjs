const identifier=/^[a-z0-9][a-z0-9._-]{0,78}$/;
const digest=/^[a-f0-9]{64}$/;
const allowed=new Set(['schema','id','version','equation','arm','seed','field_l2','field_points','sourceSha256','file','lambda_error','adam_iteration']);
export function inspectManifest(input,catalog,imports) {
  if (!input || Object.keys(input).some(k=>!allowed.has(k)) || input.schema!=='physicsai.run.v1' ||
    ![input.id,input.version,input.arm].every(v=>typeof v==='string' && identifier.test(v)) ||
    !Object.hasOwn(catalog.pdes,input.equation) || !catalog.runs.some(r=>r.arm===input.arm) ||
    !Number.isSafeInteger(input.seed) || input.seed<0 || !Number.isSafeInteger(input.adam_iteration) || input.adam_iteration<0 ||
    !Number.isFinite(input.field_l2) || input.field_l2<0 || typeof input.field_points!=='string' ||
    !identifier.test(input.field_points.toLowerCase()) || !digest.test(input.sourceSha256) ||
    typeof input.file!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.(json|npz|h5)$/.test(input.file) ||
    !(input.lambda_error===null || (['wave2d','kovasznay_inverse'].includes(input.equation) && Number.isFinite(input.lambda_error) && input.lambda_error>=0)))
    throw new Error('Manifest fields, evaluation conditions or source checksum are invalid.');
  const previous=[...catalog.runs,...imports].find(r=>r.id===input.id);
  const status=previous ? (Object.keys(input).every(k=>previous[k]===input[k])?'duplicate':'conflict') : 'new';
  return {status,id:input.id,version:input.version,checksum:input.sourceSha256};
}
export function registryRecord(input) {
  return {...input,kind:'pending validation',series:[],layerWidths:[],coefficient:null,sha256:null,origin:'owner import'};
}

