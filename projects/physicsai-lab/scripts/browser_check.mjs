import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TestBucket} from '../tests/worker.test.mjs';
const [workerPath,dataPath,playwrightPath,chrome,out]=process.argv.slice(2);
const worker=(await import(pathToFileURL(resolve(workerPath)))).default;
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)));
const env={LAB_OWNER_EMAIL:'local@example.test',BUCKET:new TestBucket()};
const server=http.createServer(async(req,res)=>{
  try {const chunks=[];for await(const c of req)chunks.push(c);
    const origin='http://127.0.0.1:'+server.address().port;
    const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:{...req.headers,'oai-authenticated-user-id':'test','oai-authenticated-user-email':env.LAB_OWNER_EMAIL},body:chunks.length?Buffer.concat(chunks):undefined}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
let browser;
try{
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--disable-gpu']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#hero').waitFor();
  const oracle=JSON.parse(await readFile(resolve(dataPath,'reference.json'),'utf8'));
  const distribution=await page.evaluate(async()=>(await (await fetch('./data/catalog.json')).json()).distribution);
  const resultsOnly=distribution==='results-only';
  const summary=resultsOnly?await page.evaluate(async()=>{
    const c=await (await fetch('./data/catalog.json')).json();
    const blocked=[];
    for(const r of c.runs)if((await fetch('./data/models/'+r.id+'.json')).status!==404)blocked.push(r.id);
    return {modelPathsChecked:c.runs.length,failed:blocked};
  }):await page.evaluate(async oracle=>{
    const {loadModel}=await import('./model.mjs'),{probePoints,matchesReference}=await import('./contract.mjs');
    const c=await (await fetch('./data/catalog.json')).json();
    let maximum=0,outputs=0;const failed=[];
    for(const r of c.runs){
      const fn=await loadModel(r),points=probePoints(c.pdes[r.equation].domain), y=fn(points);
      y.forEach((row,i)=>row.forEach((a,j)=>{const b=oracle[r.id].prediction[i][j];outputs++;maximum=Math.max(maximum,Math.abs(a-b));if(!matchesReference(a,b))failed.push(r.id);}));
    }
    return {models:c.runs.length,points:c.runs.length*36,outputs,maximum,failed};
  },oracle);
  assert.equal(summary.failed.length,0);
  const links=await page.locator('nav a').evaluateAll(a=>a.map(x=>x.hash));
  for(const link of links){await page.locator('nav a[href="'+link+'"]').click();await page.waitForFunction(()=>document.querySelector('#view').textContent.length>0);}
  await page.locator('nav a[href="#live"]').click();
  if(resultsOnly)await page.locator('input[type=file]').setInputFiles(resolve(dataPath,'models/heat2d-baseline-3234.json'));
  await page.locator('#predict:enabled').waitFor();await page.locator('#points').fill('[[2,0,0]]');await page.locator('#predict').click();assert.match(await page.locator('#prediction').innerText(),/domain/);
  await page.locator('nav a[href="#fields"]').click();
  if(resultsOnly)await page.locator('#run').selectOption('heat2d-ff-3234');
  await page.waitForFunction(mode=>document.querySelector('#range')?.textContent.includes(mode),resultsOnly?'Stored':'Derived');await page.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#time')?.value)!==35);await page.locator('#play').click();
  await page.locator('nav a[href="#import"]').click();await page.locator('#dry').waitFor();
  await page.setViewportSize({width:390,height:844});await page.locator('nav a[href="#overview"]').click();await page.locator('#hero').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  const report={engine:await browser.version(),distribution,...summary,navigation:links.length,invalidCoordinate:true,animation:true,mobile:true};
  if(out)await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();server.closeAllConnections();server.close();}

