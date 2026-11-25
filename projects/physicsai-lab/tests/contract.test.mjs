import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesReference, probePoints, validatePoints} from '../web/contract.mjs';
test('physical coordinates, shape, inclusive bounds and batch cap', () => {
  const domain = [[-Math.PI,Math.PI],[-Math.PI,Math.PI],[0,1]];
  const probes = probePoints(domain);
  assert.equal(probes.length, 36);
  assert.equal(validatePoints(probes,domain), probes);
  for (const p of [[], [[0,1]], [[0,0,1.1]], [[0,0,null]], [[0,0,'0']], [[0,0,NaN]], Array(1025).fill([0,0,0])])
    assert.throws(() => validatePoints(p,domain));
  assert.ok(matchesReference(0.000009,0));
  assert.ok(!matchesReference(0.000011,0));
  assert.ok(!matchesReference(Infinity,Infinity));
});
