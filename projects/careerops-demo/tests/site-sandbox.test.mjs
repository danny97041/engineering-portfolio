import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../integrations/sites/sandbox/worker.mjs';

test('Site worker enforces platform identity and isolates simulated principals with atomic D1 command receipts',async()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec(readFileSync(new URL('../integrations/sites/sandbox/0000_sandbox.sql',import.meta.url),'utf8'));
    const env={DB:{prepare(query){return {bind(...args){const statement=sql.prepare(query);return {
      first:()=>statement.get(...args),run:()=>statement.run(...args)
    };}};}}};
    const call=async(name,args,principal)=>{
      const headers={'content-type':'application/json'};
      if(principal) headers['oai-authenticated-user-id']=principal;
      const req=new Request('https://example.invalid/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:'qa-1',method:'tools/call',params:{name,arguments:args}})});
      const r=await worker.fetch(req,env);
      return {status:r.status,result:(await r.json()).result};
    };
    const data={id:'synthetic',key:'create',title:'Trial'};
    assert.equal((await call('get_test_record',{id:data.id})).status,401);
    assert.equal((await call('add_test_record',data,'first')).result.structuredContent.version,1);
    assert.equal((await call('get_test_record',{id:data.id},'second')).result.isError,true);
    const update={id:data.id,key:'confirm',version:1,status:'confirmed'};
    assert.equal((await call('update_test_record',update,'first')).result.structuredContent.version,2);
    assert.equal((await call('update_test_record',update,'first')).result.structuredContent.version,2);
    assert.equal((await call('update_test_record',{...update,status:'archived'},'first')).result.isError,true);
    assert.equal((await call('update_test_record',{...update,key:'archive',version:2,status:'archived'},'first')).result.structuredContent.version,3);
    assert.equal((await call('get_test_record',{id:data.id},'first')).result.structuredContent.status,'archived');
  } finally {sql.close();}
});
