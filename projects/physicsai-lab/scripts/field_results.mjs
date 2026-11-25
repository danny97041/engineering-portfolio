// Fixed grids are research results. They contain field samples, with no executable model.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {compile} from '../web/model.mjs';
const dir=process.argv[2],catalog=JSON.parse(await readFile(join(dir,'catalog.json'),'utf8'));
await mkdir(join(dir,'fields'),{recursive:true});
for(const r of catalog.runs){
  const p=catalog.pdes[r.equation],n=17,fn=compile(JSON.parse(await readFile(join(dir,'models',r.id+'.json'),'utf8')));
  const times=p.domain.length===3 && p.time_axis!==null?[0,0.5,1]:[0];
  const frames=times.map(time=>{
    const points=Array.from({length:n*n},(_,i)=>p.domain.map(([lo,hi],j)=>lo+(hi-lo)*(j===0?i%n/(n-1):j===1?Math.floor(i/n)/(n-1):time)));
    return fn(points).map(row=>row.map(v=>Number(v.toPrecision(7))));
  });
  await writeFile(join(dir,'fields',r.id+'.json'),JSON.stringify({id:r.id,n,times,frames,origin:'Derived fixed-grid browser-adapter prediction',sha256:r.sha256}));
}

