import assert from 'node:assert/strict';
import test from 'node:test';
import {createIndexCache} from '../server/index-cache.mjs';
const entry={id:'heat2d-baseline-7',equation:'heat2d',arm:'baseline',sourceSha256:'original',version:'v1',seed:7,field_l2:0.01,field_points:'test_grid',adam_iteration:100,file:'field.json'};
test('selective indexing, provenance, failed refresh and old query snapshot',()=>{
  const update=createIndexCache(),c={release:'v1',revision:0,documents:[],runs:[entry]};
  const old=update(c);assert.equal(old.changed,1);
  assert.equal(old.search('heat2d')[0].sha256,'original');assert.equal(update(c),old);
  const next=update({...c,revision:1,runs:[entry,{...entry,id:'poisson',equation:'poisson'}]});
  assert.equal(next.changed,1);assert.equal(next.search('poisson')[0].id,'poisson');assert.deepEqual(old.search('poisson'),[]);
  const retained=update({...c,revision:2,runs:[entry,entry]});assert.equal(retained.stale,true);assert.equal(retained.version,'v1/1');
  assert.deepEqual(retained.search('absent'),[]);
  assert.throws(()=>retained.search(''));
});
