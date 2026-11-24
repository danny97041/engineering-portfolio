import { check } from './contracts.mjs';

export const intents = ['planned','secondary','declined','withdraw_pending','withdrawn','undecided'];
export const stages = [
  'not_submitted','submitted','screening_pending','screening_passed','test_planned','test_completed',
  'interview_planned','interview_completed','final_pending','offered','rejected','hired','closed'
];
export const closedStages = new Set(['rejected','hired','closed']);
const closedIntents = new Set(['declined','withdrawn']);

export function nextStages(stage) {
  if (stage === 'not_submitted') return ['submitted'];
  if (closedStages.has(stage)) return [];
  const next = stages.slice(stages.indexOf(stage)+1,stages.indexOf('rejected'));
  return [...next,...(stage==='offered'?['hired']:[]),'rejected','closed'];
}
export function applicationChange(before, patch) {
  const intent = patch.intent ?? before?.intent ?? 'undecided';
  const stage = patch.stage ?? before?.stage ?? 'not_submitted';
  const previous = before?.stage ?? 'not_submitted';
  check(intents.includes(intent) && stages.includes(stage),'Unknown application status');
  check(stage === previous || nextStages(previous).includes(stage),'Invalid stage transition',409);
  if (previous === 'not_submitted' && stage === 'submitted') {
    check(patch.confirm_submission === true,'Explicit submission confirmation required',409);
    check(!closedIntents.has(intent),'Application intent excludes submission',409);
  } else {
    check(patch.confirm_submission === undefined,'Submission confirmation applies only to submitting');
  }
  return {intent,stage,submitted_at:before?.submitted_at ?? (stage === 'submitted' ? new Date().toISOString() : null)};
}
export const applicationInactive = application => Boolean(application &&
  (closedIntents.has(application.intent) || closedStages.has(application.stage)));

export function seoulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(now);
  const lookup = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return [lookup.year,lookup.month,lookup.day].join('-');
}
export function addDays(value, amount) {
  const date = new Date(value+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+amount);
  return date.toISOString().slice(0,10);
}
export function scheduleState(row,today,application) {
  if (row.status === 'completed' || row.status === 'cancelled') return 'history';
  if (!row.start_date) return applicationInactive(application) ? 'excluded' : 'undated';
  if ((row.end_date ?? row.start_date) < today) return 'history';
  return applicationInactive(application) ? 'excluded' : 'active';
}
export function overlappingSchedules(rows) {
  const times = rows.filter(row => row.bucket === 'active' && row.start_time && row.end_time);
  const conflicts = new Set();
  for (const [i,a] of times.entries()) {
    const start = a.start_date+'T'+a.start_time;
    const end = (a.end_date ?? a.start_date)+'T'+a.end_time;
    for (const b of times.slice(i+1)) {
      const otherStart = b.start_date+'T'+b.start_time;
      const otherEnd = (b.end_date ?? b.start_date)+'T'+b.end_time;
      if (start < end && otherStart < otherEnd && start < otherEnd && otherStart < end) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}
