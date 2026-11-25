import { transaction } from './transaction.mjs';
export { transaction };
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const migrations = new URL('./migrations/', import.meta.url);
export function openStore(root, realm, stage) {
  if (!['personal','demo'].includes(realm) || !['development','operational'].includes(stage))
    throw Error('Unknown deployment binding');
  if (realm === 'demo' && stage === 'operational') throw Error('Demo must use development storage');
  const dir = join(root,realm,stage);
  mkdirSync(dir,{recursive:true});
  const db = new DatabaseSync(join(dir,'careerops.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    transaction(db, () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) {
        const binding = db.prepare('SELECT realm,stage FROM instance_binding WHERE singleton=1').get();
        if (binding?.realm !== realm || binding.stage !== stage) throw Error('Storage binding mismatch');
      }
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
      const files = readdirSync(migrations).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
      const applied = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
      if (applied.some((row,i)=>row.name !== files[i])) throw Error('Unsupported migration history');
      for (const [i,name] of files.entries()) {
        const sql = readFileSync(new URL(name,migrations),'utf8');
        const digest = createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
        if (i < applied.length) {
          if (applied[i].sha256 !== digest) throw Error('Applied migration checksum changed');
          continue;
        }
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(name,digest);
      }
      if (!tables.length) {
        db.prepare('INSERT INTO instance_binding VALUES (1,?,?)').run(realm,stage);
        db.exec("INSERT INTO users VALUES ('owner','owner'),('reader','viewer'); INSERT INTO profiles VALUES ('owner','{}',1)");
      }
    });
    return db;
  } catch (error) { db.close(); throw error; }
}
