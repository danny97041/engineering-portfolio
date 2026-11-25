import { createHash, timingSafeEqual } from 'node:crypto';

const readTools=new Set(['get_dashboard','search_jobs','get_job_details','check_duplicate','get_scan_runs','validate_import']);
const writeTools=new Set(['import_job_batch','record_scan_run']);
const digest=value=>createHash('sha256').update(value).digest();
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value);

export function scanAccess(realm,headers,env){
  const supplied=headers.get('x-careerops-scan-key');
  if(supplied===null) return null;
  const {CAREEROPS_SCAN_READ_KEY:reader,CAREEROPS_SCAN_WRITE_KEY:writer,CAREEROPS_SCAN_OWNER:owner}=env;
  if(realm!=='personal'||!valid(supplied)||!valid(reader)||!valid(writer)||reader===writer||
     typeof owner!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(owner)) return {denied:true};
  const key=digest(supplied);
  if(timingSafeEqual(key,digest(reader))) return {owner,write:false};
  if(timingSafeEqual(key,digest(writer))) return {owner,write:true};
  return {denied:true};
}

export function allowedScanMethod(access,message){
  if(['initialize','server/discover','tools/list','ping'].includes(message?.method)) return true;
  return message?.method==='tools/call'&&allowedScanTool(access,message.params?.name);
}

export function allowedScanTool(access,name){
  return readTools.has(name)||(access.write&&writeTools.has(name));
}

export function isScanWrite(name){return writeTools.has(name);}
