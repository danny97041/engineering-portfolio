import { transaction } from '../../packages/database/local.mjs';

export function createSandboxReset(db){
  const binding=db.prepare('SELECT realm,stage FROM instance_binding').get();
  if(binding?.realm!=='demo'||binding.stage!=='development'||
    !db.prepare("SELECT 1 FROM app_settings WHERE key='portfolio.v1'").get()) throw Error('Reset requires a seeded demo database');
  const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(r=>r.name);
  const quoted=n=>'"'+n.replaceAll('"','""')+'"';
  const snapshots=names.filter(n=>!['instance_binding','users','schema_migrations'].includes(n)).map(name=>{
    const table=quoted(name), rows=db.prepare('SELECT * FROM '+table).all();
    return {table,rows};
  });
  return ()=>transaction(db,()=>{
    db.exec('PRAGMA defer_foreign_keys=ON');
    for(const {table} of [...snapshots].reverse()) db.exec('DELETE FROM '+table);
    for(const {table,rows} of snapshots){
      if(!rows.length) continue;
      const columns=Object.keys(rows[0]);
      const insert=db.prepare('INSERT INTO '+table+' ('+columns.map(quoted).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')');
      for(const row of rows) insert.run(...columns.map(k=>row[k]));
    }
    return {reset:true};
  });
}
