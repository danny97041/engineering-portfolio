import { createHash } from 'node:crypto';
import { transaction } from './transaction.mjs';

export function migrateStore(db, entries) {
  transaction(db,()=>{
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
    const applied=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
    if(applied.some((row,i)=>row.name!==entries[i]?.[0])) throw Error('Unsupported migration history');
    for(const [i,[name,sql]] of entries.entries()){
      const checksum=createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
      if(i<applied.length){
        if(applied[i].sha256!==checksum) throw Error('Applied migration checksum changed');
      } else {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(name,checksum);
      }
    }
  });
}
