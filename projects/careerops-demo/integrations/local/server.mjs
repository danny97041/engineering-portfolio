import { createServer } from 'node:http';
import { MAX_BODY, createHandler } from '../../packages/api/http.mjs';
import { CareerService } from '../../packages/application/service.mjs';

export function startServer(db,{realm,stage,ownerKey,readerKey,port}) {
  const binding = db.prepare('SELECT realm,stage FROM instance_binding').get();
  if (binding.realm !== realm || binding.stage !== stage) throw Error('Storage binding mismatch');
  const handle = createHandler(new CareerService(db),realm,stage,ownerKey,readerKey);
  const server = createServer(async (incoming,out)=>{
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming.iterator({destroyOnReturn:false})) {
        length += chunk.length;
        if (length > MAX_BODY) {
          out.writeHead(413,{'connection':'close','cache-control':'no-store'}).end();
          incoming.resume();
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(new URL(incoming.url,'http://127.0.0.1'),{
        headers:incoming.headers, method:incoming.method, body:chunks.length ? Buffer.concat(chunks) : undefined
      });
      const response = await handle(request);
      out.writeHead(response.status,Object.fromEntries(response.headers));
      out.end(Buffer.from(await response.arrayBuffer()));
    } catch { out.writeHead(400,{'cache-control':'no-store'}).end(); }
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>resolve(server));
  });
}
