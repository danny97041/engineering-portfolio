import { fileURLToPath } from 'node:url';
import { openStore } from '../packages/database/local.mjs';
import { restore, snapshot } from '../packages/database/recovery.mjs';

const [mode,target,base,delta]=process.argv.slice(2);
const binding={realm:process.env.CAREEROPS_REALM,stage:process.env.CAREEROPS_STAGE};
if(!target || !['personal','demo'].includes(binding.realm) || !['development','operational'].includes(binding.stage) ||
   (binding.realm==='demo' && binding.stage!=='development')) throw Error('Select a CareerOps binding and a new output path');
if(mode==='backup'){
  const db=openStore(fileURLToPath(new URL('../.state/',import.meta.url)),binding.realm,binding.stage);
  try {console.log(snapshot(db,target,base));} finally {db.close();}
} else if(mode==='restore' && base) console.log(restore(base,target,binding,delta));
else throw Error('Usage: recovery.mjs backup TARGET [BASE] | restore TARGET BASE [DELTA]');
