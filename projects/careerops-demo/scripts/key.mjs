import { randomBytes } from 'node:crypto';
const [realm,stage] = process.argv.slice(2);
if (!['personal', 'demo'].includes(realm) || !['development','operational'].includes(stage))
  throw Error('Expected realm and stage');
console.log([realm,stage,randomBytes(32).toString('base64url')].join('.'));
