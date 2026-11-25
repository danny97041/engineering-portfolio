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

