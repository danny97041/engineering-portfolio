import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compile,sha256} from '../web/model.mjs';
import {matchesReference,probePoints,parity} from '../web/contract.mjs';
import {exact} from '../web/physics.mjs';
const dir=process.argv[2];
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const {runs,pdes,release}=await read('catalog.json');
const oracle=await read('reference.json');
const models={};
for (const run of runs) {
  const raw=await readFile(join(dir,'models',run.id+'.json'));
  const p=pdes[run.equation], points=probePoints(p.domain);
  const predictions=compile(JSON.parse(raw))(points);
  const ref=oracle[run.id];
  let maximum=0, failures=0, exactMaximum=0;
  if (await sha256(raw)!==run.sha256 || predictions.length!==points.length) throw Error('Invalid artifact');
  for (let i=0;i<points.length;i++) {
    const analytic=exact(run.equation,points[i],p);
    if (predictions[i].length!==p.outputs.length) throw Error('Wrong output shape');
    for (let j=0;j<p.outputs.length;j++) {
      const a=predictions[i][j], b=ref.prediction[i][j];
      maximum=Math.max(maximum,Math.abs(a-b));
      exactMaximum=Math.max(exactMaximum,Math.abs(analytic[j]-ref.exact[i][j]));
      if (!matchesReference(a,b)) failures++;
    }
  }
  models[run.id]={verified:failures===0 && exactMaximum<1e-11,failures,maximum,exactMaximum};
}
const report={release,parity,models};
await writeFile(join(dir,'validation.json'),JSON.stringify(report));
const failed=Object.entries(models).filter(([,m])=>!m.verified);
console.log(JSON.stringify({checked:runs.length,failed,maximum:Math.max(...Object.values(models).map(m=>m.maximum))}));
process.exitCode=failed.length?1:0;
