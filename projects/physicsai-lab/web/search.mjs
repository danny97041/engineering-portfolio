const terms=s=>s.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];
export function evidenceIndex(catalog) {
  const docs=catalog.documents.flatMap(doc=>doc.text.split(/\n\s*\n/).filter(Boolean).map((text,i)=>({
    id:doc.id+'-'+i,source:doc.id,sha256:doc.sha256,text,release:catalog.release
  })));
  for (const r of catalog.runs) docs.push({id:r.id,source:r.file,sha256:r.sourceSha256,release:r.version,
    text:[r.equation,r.arm,'seed',r.seed,'field_l2',r.field_l2,'evaluation',r.field_points,'Adam iterations',r.adam_iteration].join(' ')});
  const postings=new Map(); let total=0;
  for (const [i,doc] of docs.entries()) {
    const words=terms(doc.id+' '+doc.text); doc.length=words.length; total+=words.length;
    for (const word of words) {
      if (!postings.has(word)) postings.set(word,new Map());
      const list=postings.get(word); list.set(i,(list.get(i)??0)+1);
    }
  }
  return function search(query,k=5) {
    if (typeof query!=='string' || !query.trim() || query.length>512 || !Number.isInteger(k) || k<1 || k>20)
      throw new Error('Enter 1–512 characters and 1–20 results.');
    const scores=new Map(), avg=total/docs.length;
    for (const word of new Set(terms(query))) {
      const hits=postings.get(word); if (!hits) continue;
      const idf=Math.log(1+(docs.length-hits.size+0.5)/(hits.size+0.5));
      for (const [i,f] of hits) {
        const norm=1.2*(0.25+0.75*docs[i].length/avg);
        scores.set(i,(scores.get(i)??0)+idf*f*2.2/(f+norm));
      }
    }
    return [...scores].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,k).map(([i,score])=>({...docs[i],score}));
  };
}
export function compare(runs,equation) {
  const grouped=new Map();
  for (const r of runs.filter(r=>r.equation===equation)) {
    const key=JSON.stringify([r.arm,r.field_points,r.version]);
    if (!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(r);
  }
  return [...grouped.values()].map(group=>{
    const n=group.length, mean=group.reduce((a,r)=>a+r.field_l2,0)/n;
    return {method:group[0].arm, evaluation:group[0].field_points,release:group[0].version,n,mean,
      variance:n>1?group.reduce((a,r)=>a+(r.field_l2-mean)**2,0)/(n-1):null};
  });
}
