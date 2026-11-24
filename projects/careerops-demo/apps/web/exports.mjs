function quote(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
const markdownCell = value => String(value ?? '').replaceAll('\\','\\\\').replaceAll('|','\\|').replace(/\r?\n/g,' ');
export const csv = (headers,rows) => [headers,...rows].map(row=>row.map(quote).join(',')).join('\r\n');
export const markdown = (headers,rows) => [headers,headers.map(()=>'---'),...rows]
  .map(row=>'| '+row.map(markdownCell).join(' | ')+' |').join('\n');

const icalText = value => String(value ?? '').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(',','\\,').replaceAll(';','\\;');
const compact = value => value.replaceAll('-','').replaceAll(':','');
function nextDay(value) {
  const date = new Date(value+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
}
function fold(line) {
  let segment = '';
  const lines = [];
  const bytes = new TextEncoder();
  for (const char of line) {
    if (bytes.encode(segment+char).length > 75) { lines.push(segment); segment=' '; }
    segment+=char;
  }
  return [...lines,segment].join('\r\n');
}
export function ics(rows,now=new Date()) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CareerOps//Schedule//EN','CALSCALE:GREGORIAN'];
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g,'');
  for (const row of rows) {
    if (!row.start_date) continue;
    const text = [row.condition_note,row.notes].filter(Boolean);
    const isTimed = Boolean(row.start_time);
    if (!isTimed) text.push('Start time unspecified'+(row.end_time ? ' · Known deadline '+row.end_time : ''));
    const start = isTimed ? 'DTSTART:'+compact(row.start_date)+'T'+compact(row.start_time)+'00+0900' : 'DTSTART;VALUE=DATE:'+compact(row.start_date);
    const endDate = row.end_date ?? row.start_date;
    const end = isTimed ? (row.end_time ? 'DTEND:'+compact(endDate)+'T'+compact(row.end_time)+'00+0900' : null) :
      'DTEND;VALUE=DATE:'+compact(nextDay(endDate));
    const toUtc = field => field?.endsWith('+0900')
      ? field.replace(/:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})00\+0900$/,
        (_,y,m,d,h,min)=>':'+new Date(Date.UTC(+y,+m-1,+d,+h-9,+min)).toISOString().replace(/[-:]|\.\d{3}/g,''))
      : field;
    lines.push('BEGIN:VEVENT','UID:'+icalText(row.id)+'@careerops','DTSTAMP:'+stamp,toUtc(start));
    if (end) lines.push(toUtc(end));
    lines.push('SUMMARY:'+icalText(row.title));
    if (row.location) lines.push('LOCATION:'+icalText(row.location));
    if (text.length) lines.push('DESCRIPTION:'+icalText(text.join('\n')));
    if (row.certainty !== 'confirmed' || row.status === 'conditional' || !isTimed) lines.push('STATUS:TENTATIVE');
    lines.push('END:VEVENT');
  }
  return [...lines,'END:VCALENDAR',''].map(fold).join('\r\n');
}
