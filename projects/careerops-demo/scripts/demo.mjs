import { randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../packages/database/local.mjs';
import { startServer } from '../integrations/local/server.mjs';
import { createSandboxReset } from '../integrations/local/sandbox.mjs';
import { seedPortfolio } from '../fixtures/synthetic/portfolio.mjs';

const root=mkdtempSync(join(tmpdir(),'careerops-portfolio-'));
const realm='demo',stage='development';
const ownerKey=realm+'.'+stage+'.'+randomBytes(32).toString('base64url');
let db;
try {
  db=openStore(root,realm,stage);
  const counts=seedPortfolio(db);
  const server=await startServer(db,{realm,stage,ownerKey,port:0,sandboxReset:createSandboxReset(db)});
  console.log('CareerOps synthetic sandbox http://127.0.0.1:'+server.address().port);
  console.log('Session key: '+ownerKey);
  console.log(JSON.stringify(counts));
  const stop=()=>server.close(()=>{
    db.close();
    rmSync(root,{recursive:true,force:true});
  });
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
} catch(error){
  db?.close();
  rmSync(root,{recursive:true,force:true});
  throw error;
}
