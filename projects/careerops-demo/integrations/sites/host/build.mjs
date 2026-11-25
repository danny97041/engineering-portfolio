import { build } from 'esbuild';
import { mkdtempSync,rmSync,readFileSync,readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../../../packages/database/local.mjs';
import { seedPortfolio } from '../../../fixtures/synthetic/portfolio.mjs';
const [realm,destination]=process.argv.slice(2);
if(!['personal','demo'].includes(realm)||!destination) throw Error('Expected personal|demo and output JS file');
const stage=realm==='personal'?'operational':'development';
const root=fileURLToPath(new URL('../../../',import.meta.url)),host=fileURLToPath(new URL('./',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'careerops-build-'));
try {
  const db=openStore(temp,realm,stage);
  try {if(realm==='demo') seedPortfolio(db);} finally {db.close();}
  const baseline=gzipSync(readFileSync(join(temp,realm,stage,'careerops.sqlite'))).toString('base64');
  const migrationDir=join(root,'packages/database/migrations');
  const migrations=readdirSync(migrationDir).filter(name=>/^\d{3}_.+\.sql$/.test(name)).sort()
    .map(name=>[name,readFileSync(join(migrationDir,name),'utf8')]);
  const assets={};
  for(const name of ['index.html','styles.css','app.mjs','dom.mjs','forms.mjs','analysis.mjs','advanced.mjs','exports.mjs','workflow.mjs','contracts.mjs']){
    const domain=['workflow.mjs','contracts.mjs'].includes(name);
    let content=readFileSync(join(root,domain?'packages/domain':'apps/web',name),'utf8');
    if(name==='app.mjs') content+="\nstate.token='site-session';load().catch(error=>report(error.message,true));\n";
    assets[name==='index.html'?'/':'/assets/'+name]=[name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'text/javascript',content];
  }
  await build({entryPoints:[join(host,'worker.mjs')],outfile:resolve(destination),bundle:true,format:'esm',platform:'browser',minify:true,
    // The asm.js build has no external binary to locate. Workers have no browser location.
    define:{'self.location.href':'""','process.versions.node':'undefined','Buffer':'byteCounter'},banner:{js:'const byteCounter={byteLength:value=>new TextEncoder().encode(value).length};'},
    plugins:[{name:'careerops-worker',setup(plugin){
      plugin.onResolve({filter:/database\/local\.mjs$/},()=>({path:join(root,'packages/database/transaction.mjs')}));
      plugin.onResolve({filter:/^node:crypto$/},()=>({path:join(host,'crypto.mjs')}));
      plugin.onResolve({filter:/^(node:perf_hooks|node:fs|deployment-data)$/},args=>({path:args.path,namespace:'generated'}));
      plugin.onLoad({filter:/.*/,namespace:'generated'},args=>({contents:args.path==='node:fs'?'export default {};':args.path==='node:perf_hooks'?'export const performance=globalThis.performance;':
        'export const realm='+JSON.stringify(realm)+',stage='+JSON.stringify(stage)+',assets='+JSON.stringify(assets)+',baseline='+JSON.stringify(baseline)+',migrations='+JSON.stringify(migrations)+';'}));
    }}]});
} finally {rmSync(temp,{recursive:true,force:true});}
