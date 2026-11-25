export class SqlStore {
  constructor(raw){
    this.raw=raw;this.isTransaction=false;this.dirty=false;
    this.transactionDirty=false;this.savepoints=new Map();
    raw.run('PRAGMA foreign_keys=ON');
  }
  exec(sql){
    this.raw.run(sql);
    for(const command of sql.split(';').map(part=>part.trim())){
      const [operation,...args]=command.toUpperCase().split(/\s+/);
      if(operation==='BEGIN'){
        this.isTransaction=true;this.transactionDirty=this.dirty;
      }
      if(operation==='SAVEPOINT') this.savepoints.set(args[0],this.dirty);
      if(operation==='ROLLBACK'){
        if(args[0]==='TO') this.dirty=this.savepoints.get(args[1])??this.dirty;
        else this.dirty=this.transactionDirty;
      }
      if(operation==='RELEASE') this.savepoints.delete(args[0]);
      if(operation==='COMMIT'||(operation==='ROLLBACK'&&!args.length)){
        this.isTransaction=false;this.savepoints.clear();
      }
      if(['INSERT','UPDATE','DELETE','REPLACE'].includes(operation)) this.dirty=true;
    }
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
