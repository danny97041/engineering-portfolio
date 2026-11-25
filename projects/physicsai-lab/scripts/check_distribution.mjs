// Inventory the actual emitted asset map before external transfer.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const source=await readFile(process.argv[2],'utf8');
const line=source.split('\n').find(l=>l.startsWith('var assets = '));
if(!line || !line.endsWith(';'))throw Error('Unknown bundle format');
const assets=JSON.parse(line.slice('var assets = '.length,-1));
const read=k=>JSON.parse(gunzipSync(Buffer.from(assets[k][1],'base64')));
const catalog=read('/data/catalog.json'),validation=read('/data/validation.json');
assert.equal(catalog.distribution,'results-only');
assert.equal(catalog.runs.length,65);
const allowed=new Set(['/app.mjs','/index.html','/style.css','/model.mjs','/physics.mjs','/plots.mjs','/contract.mjs','/search.mjs','/package.mjs','/registry.mjs','/data/catalog.json','/data/validation.json']);
for (const run of catalog.runs){
  const path='/data/fields/'+run.id+'.json',field=read(path);
  assert.deepEqual(Object.keys(field).sort(),['id','n','times','frames','origin','sha256'].sort());
  assert.equal(field.n,17);
  for(const frame of field.frames){assert.equal(frame.length,17*17);assert.ok(frame.every(row=>row.length===catalog.pdes[run.equation].outputs.length && row.every(Number.isFinite)));}
  assert.equal(validation.models[run.id].verified,true);
  allowed.add(path);
}
assert.deepEqual(new Set(Object.keys(assets)),allowed);
console.log(JSON.stringify({distribution:catalog.distribution,assets:allowed.size,fieldGrids:catalog.runs.length,weightAssets:0}));

