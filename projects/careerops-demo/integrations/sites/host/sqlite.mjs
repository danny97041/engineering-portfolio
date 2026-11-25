export class SqlStore {
  constructor(raw){this.raw=raw;this.isTransaction=false;this.dirty=false;raw.run('PRAGMA foreign_keys=ON');}
  exec(sql){
    this.raw.run(sql);
    if(/^BEGIN\b/i.test(sql)) this.isTransaction=true;
    if(/^(COMMIT|ROLLBACK$)/i.test(sql)) this.isTransaction=false;
    if(/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) this.dirty=true;
  }
  prepare(sql){
    const perform=(args,mode)=>{
      const stmt=this.raw.prepare(sql);
      try {
        stmt.bind(args);
        if(mode==='run'){stmt.step();this.dirty=true;return {changes:this.raw.getRowsModified()};}
        if(mode==='get') return stmt.step()?stmt.getAsObject():undefined;
        const rows=[];
        while(stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } catch(error){
        if(/UNIQUE constraint failed/.test(error.message)) error.errcode=2067;
        if(/CHECK constraint failed/.test(error.message)) error.errcode=275;
        throw error;
      } finally {stmt.free();}
    };
    return {all:(...args)=>perform(args,'all'),get:(...args)=>perform(args,'get'),run:(...args)=>perform(args,'run')};
  }
}
