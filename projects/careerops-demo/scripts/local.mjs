import { fileURLToPath } from 'node:url';
import { openStore } from '../packages/database/local.mjs';
import { seed } from '../fixtures/synthetic/seed.mjs';
import { startServer } from '../integrations/local/server.mjs';

const [command] = process.argv.slice(2);
if (!['migrate', 'seed', 'serve'].includes(command)) {
  throw new Error('Expected migrate, seed, or serve');
}

const realm = 'demo';
const stage = 'development';
const db = openStore(fileURLToPath(new URL('../.state/', import.meta.url)), realm, stage);

if (command === 'serve') {
  try {
    const server = await startServer(db, {
      realm,
      stage,
      port: Number(process.env.PORT ?? 4312),
      ownerKey: process.env.CAREEROPS_TOKEN,
      readerKey: process.env.CAREEROPS_READ_TOKEN
    });
    console.log('CareerOps Demo listening at http://127.0.0.1:' + server.address().port);
    const stop = () => server.close(() => db.close());
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    db.close();
    throw error;
  }
} else {
  try {
    console.log(command === 'seed' ? seed(db) : 'Demo migration complete');
  } finally {
    db.close();
  }
}
