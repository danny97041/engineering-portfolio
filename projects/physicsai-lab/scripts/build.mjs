// Build a private single-module Sites Worker. Generated data stays outside source control.
import {readFile,writeFile,mkdir,mkdtemp,readdir,cp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const [dataArg,outArg,esbuild,mode='results-only']=process.argv.slice(2);
if(!['results-only','local-models'].includes(mode))throw Error('Invalid distribution mode');
if(!esbuild)throw Error('Usage: node scripts/build.mjs <verified-data-dir> <worker-file> <esbuild-executable>');
const data=resolve(dataArg),out=resolve(outArg),root=fileURLToPath(new URL('../',import.meta.url));
const stage=await mkdtemp(join(tmpdir(),'physicsai-build-'));
await cp(join(root,'web'),join(stage,'web'),{recursive:true});
await cp(join(root,'server'),join(stage,'server'),{recursive:true});
const assets=Object.create(null);
async function add(path,file,mime){
  assets[path]=[mime,gzipSync(await readFile(file),{level:9}).toString('base64')];
}
for(const name of await readdir(join(root,'web'))){
  const mime=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
  await add('/'+name,join(root,'web',name),mime);
}
await add('/data/validation.json',join(data,'validation.json'),'application/json');
const catalog=JSON.parse(await readFile(join(data,'catalog.json'),'utf8'));
catalog.distribution=mode;
assets['/data/catalog.json']=['application/json',gzipSync(JSON.stringify(catalog)).toString('base64')];
for(const run of catalog.runs){
  await add('/data/fields/'+run.id+'.json',join(data,'fields',run.id+'.json'),'application/json');
  if(mode==='local-models')await add('/data/models/'+run.id+'.json',join(data,'models',run.id+'.json'),'application/json');
}
await writeFile(join(stage,'server/embedded.mjs'),'export const assets='+JSON.stringify(assets));
await mkdir(dirname(out),{recursive:true});
execFileSync(resolve(esbuild),[join(stage,'server/worker.mjs'),'--bundle','--format=esm','--platform=browser','--target=es2022','--outfile='+out],{stdio:'inherit'});

