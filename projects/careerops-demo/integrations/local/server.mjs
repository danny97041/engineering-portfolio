import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { MAX_BODY, createHandler } from '../../packages/api/http.mjs';
import { CareerService } from '../../packages/application/service.mjs';

const assets = {
  '/assets/advanced.mjs':['text/javascript','../../apps/web/advanced.mjs'],
  '/':['text/html','../../apps/web/index.html'],
  '/assets/styles.css':['text/css','../../apps/web/styles.css'],
  '/assets/app.mjs':['text/javascript','../../apps/web/app.mjs'],
  '/assets/forms.mjs':['text/javascript','../../apps/web/forms.mjs'],
  '/assets/dom.mjs':['text/javascript','../../apps/web/dom.mjs'],
  '/assets/exports.mjs':['text/javascript','../../apps/web/exports.mjs'],
  '/assets/analysis.mjs':['text/javascript','../../apps/web/analysis.mjs'],
  '/assets/workflow.mjs':['text/javascript','../../packages/domain/workflow.mjs'],
  '/assets/contracts.mjs':['text/javascript','../../packages/domain/contracts.mjs']
};

export function startServer(db,{realm,stage,ownerKey,readerKey,port}) {
  const binding = db.prepare('SELECT realm,stage FROM instance_binding').get();
  if (binding.realm !== realm || binding.stage !== stage) throw Error('Storage binding mismatch');
  const handle = createHandler(new CareerService(db),realm,stage,ownerKey,readerKey);
  const server = createServer(async (incoming,out)=>{
    try {
      const target = new URL(incoming.url,'http://127.0.0.1');
      if (incoming.method === 'GET' && Object.hasOwn(assets,target.pathname)) {
        const [type,path] = assets[target.pathname];
        out.writeHead(200,{
          'content-type':type+'; charset=utf-8','x-content-type-options':'nosniff','cache-control':'no-store',
          'content-security-policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        }).end(readFileSync(new URL(path,import.meta.url)));
        return;
      }
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
      const request = new Request(target,{
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
