import { createHash, timingSafeEqual } from 'node:crypto';
import { gateway } from './gateway.mjs';
import { ApiError, check, object } from '../domain/contracts.mjs';
import { applications, changeApplication, previewEdits, undoEdit, workspace } from '../application/workspace.mjs';
import { analysisIndex, ingestPosting, intakeQueue, recordAssessment, reviewPosting, setExclusion, updateFacts, updateWeights } from '../application/analysis.mjs';

export const MAX_BODY = 16384;
const digest = value => createHash('sha256').update(value).digest();
async function jsonBody(request) {
  check(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json','Expected application/json',415);
  const raw = await request.text();
  check(Buffer.byteLength(raw) <= MAX_BODY,'Request too large',413);
  let body;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400,'Invalid JSON'); }
  return object(body);
}
export function createHandler(service, realm, stage, ownerKey, readerKey) {
  const prefix = realm + '.' + stage + '.';
  const valid = key => typeof key === 'string' && key.startsWith(prefix) && /^[A-Za-z0-9_-]{43}$/.test(key.slice(prefix.length));
  if (!valid(ownerKey) || (readerKey !== undefined && (!valid(readerKey) || readerKey === ownerKey)))
    throw Error('Supply distinct, instance-scoped credentials');
  const owner = digest(ownerKey);
  const reader = readerKey && digest(readerKey);
  return async request => {
    const json = (status, value) => Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    try {
      const auth = request.headers.get('authorization');
      check(auth?.startsWith('Bearer '),'Authentication required',401);
      const key = digest(auth.slice(7));
      const actor = timingSafeEqual(key,owner) ? 'owner' : reader && timingSafeEqual(key,reader) ? 'reader' : null;
      check(actor,'Invalid credential',401);
      const url = new URL(request.url);
      const response=await gateway(service,actor,request,url,json,jsonBody);
      if (response) return response;
      check(!url.search, 'Unknown query parameter',400);
      const match = /^\/api\/v1\/(companies|job_postings|schedules|profile|applications|workspace|job_details|undo|batch_preview|analysis|analysis_facts|analysis_weights|assessments|intake|exclusions)(?:\/([\w-]+))?$/.exec(url.pathname);
      check(match,'Route not found',404);
      const [,type,id] = match;
      const method = request.method;
      if (['analysis','analysis_facts','analysis_weights','assessments','intake','exclusions'].includes(type)) {
        service.authorize(actor,true);
        if (type==='analysis' && method==='GET') return json(200,id?reviewPosting(service,actor,id):analysisIndex(service,actor));
        if (type==='intake' && !id && method==='GET') return json(200,intakeQueue(service,actor));
        if (type==='analysis_facts' && id && method==='PUT') return json(200,updateFacts(service,actor,id,await jsonBody(request)));
        if (type==='analysis_weights' && !id && method==='PUT') return json(200,updateWeights(service,actor,await jsonBody(request)));
        if (type==='assessments' && id && method==='POST') return json(200,recordAssessment(service,actor,id,await jsonBody(request)));
        if (type==='intake' && !id && method==='POST') return json(200,ingestPosting(service,actor,await jsonBody(request)));
        if (type==='exclusions' && !id && method==='PUT') return json(200,setExclusion(service,actor,await jsonBody(request)));
        throw new ApiError(405,'Method not allowed');
      }
      if (type==='undo') {
        check(method==='POST' && /^[1-9]\d*$/.test(id ?? ''),'Route not found',404);
        return json(200,undoEdit(service,actor,id));
      }
      if (type === 'profile') check(!id,'Route not found',404);
      if (type === 'workspace' || type === 'job_details') {
        check(method === 'GET','Method not allowed',405);
        if (type === 'workspace') {
          check(!id,'Route not found',404);
          return json(200,workspace(service,actor));
        }
        check(id,'Route not found',404);
        service.read(actor,'job_postings',id);
        return json(200,service.relations('job_postings',id));
      }
      if (method === 'GET') {
        if (type === 'profile') return json(200,service.profile(actor));
        if (type === 'applications') return json(200,applications(service,actor,id));
        return json(200,service.read(actor,type,id));
      }
      service.authorize(actor,true);
      const isProfile = type === 'profile' && method === 'PUT';
      const creating = type !== 'profile' && !id && method === 'POST';
      const editing = !['profile','batch_preview'].includes(type) && id && method === 'PATCH';
      const deleting = !['profile','applications','batch_preview'].includes(type) && id && method === 'DELETE';
      check(isProfile || creating || editing || deleting, 'Method not allowed',405);
      const tag = request.headers.get('if-match');
      if (!creating) check(/^"[1-9]\d*"$/.test(tag ?? ''),'Provide If-Match with quoted version',428);
      const version = creating ? undefined : Number(tag.slice(1,-1));
      const body = deleting ? undefined : await jsonBody(request);
      if (type==='batch_preview') return json(200,previewEdits(service,actor,body));
      const data = isProfile ? service.setProfile(actor,version,body) :
        type === 'applications' ? changeApplication(service,actor,id,version,body) : service.mutate(actor,type,id,version,body);
      return json(creating ? 201 : 200,data);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('CareerOps request failed',error.code ?? error.name);
      return json(error instanceof ApiError ? error.status : 500,{error:error instanceof ApiError ? error.message : 'Internal server error'});
    }
  };
}
