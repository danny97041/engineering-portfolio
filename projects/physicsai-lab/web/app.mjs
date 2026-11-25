import {compile,loadModel,sha256} from './model.mjs';
import {exact,axes,descriptions} from './physics.mjs';
import {heat,lines} from './plots.mjs';
import {compare} from './search.mjs';
import {fileLimit,unpackPackage} from './package.mjs';

const $=s=>document.querySelector(s);
const view=$('#view'), controls=$('#controls');
const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number.isFinite(x)?Number(x.toPrecision(5)).toString():'—';
const table=(heads,rows)=>'<div class="tablewrap"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const facts=rows=>'<dl>'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';
const sel=(label,id,values,selected)=>'<label>'+esc(label)+'<select id="'+id+'">'+values.map(v=>{const [key,name]=Array.isArray(v)?v:[v,v];return '<option value="'+esc(key)+'" '+(String(key)===String(selected)?'selected':'')+'>'+esc(name)+'</option>';}).join('')+'</select></label>';
const methods={baseline:'Baseline PINN',loss_sa:'Self-Adaptive Loss',ff:'Fourier Features',ff_loss_sa:'Fourier + Self-Adaptive',ff_curriculum:'Fourier + Curriculum'};
const groups={Workspace:[['overview','Overview'],['pdes','PDE Explorer'],['experiments','Experiment Explorer'],['comparison','Model Comparison']],
'Model analysis':[['fields','Field Visualization'],['live','Live Inference'],['training','Training Analysis'],['inverse','Inverse Problems'],['models','Model Registry']],
'Research tools':[['rag','RAG Explorer'],['agent','Agent Playground'],['artifacts','Dataset / Artifacts'],['workspace','Experiment Comparison'],['import','Import Center']],
'Project':[['releases','Release History'],['validation','Validation Dashboard'],['api','API Documentation'],['engineering','Engineering']]};
const navigation=Object.values(groups).flat();
$('#navigation').innerHTML=Object.entries(groups).map(([name,links])=>'<h2>'+name+'</h2>'+links.map(([id,label])=>'<a href="#'+id+'">'+label+'</a>').join('')).join('');
const state={eq:'heat2d',run:'heat2d-baseline-3234',component:0,time:0.35,arm:'all',seed:'all',sort:'field_l2'};
let catalog,validation,session,interval,epoch=0;
const models=new Map();
const request=async (url,init)=>{const r=await fetch(url,init);if(!r.ok)throw Error((await r.text()).slice(0,200)||'Request failed '+r.status);return r.json();};
const active=()=>catalog.runs.find(r=>r.id===state.run);
const verified=r=>validation.models[r.id]?.verified===true;
const load=async r=>{if(!verified(r))throw Error('Awaiting numerical validation.');
  if(!models.has(r.id)) {const predictor=await loadModel(r);if(models.size>=3)models.delete(models.keys().next().value);models.set(r.id,predictor);}
  return models.get(r.id);};
function list(eq=state.eq){return catalog.runs.filter(r=>r.equation===eq);}
function chooseEq(eq){state.eq=eq;state.run=list().find(r=>r.arm==='baseline')?.id??list()[0].id;state.component=0;}
function filters(pde=true,model=false,extra=''){
  const pdes=Object.keys(catalog.pdes).map(k=>[k,descriptions[k]?.[0]??k]);
  controls.innerHTML='<div class="filters">'+(pde?sel('Equation','eq',pdes,state.eq):'')+
    (model?sel('Experiment','run',list().map(r=>[r.id,methods[r.arm]+' · '+r.seed+' · '+r.version]),state.run):'')+extra+'</div>';
  if($('#eq'))$('#eq').onchange=e=>{chooseEq(e.target.value);render();};
  if($('#run'))$('#run').onchange=e=>{state.run=e.target.value;render();};
}
function experiment(page){
  const extras=sel('Method','arm',['all',...Object.keys(methods)].map(k=>[k,methods[k]??'All methods']),state.arm)+sel('Seed','seed',['all',...new Set(list().map(r=>r.seed))],state.seed)+sel('Order','sort',[['field_l2','Selected field L2'],['adam_iteration','Adam iterations'],['seed','Seed']],state.sort);
  filters(true,false,extras);
  for(const k of ['arm','seed','sort'])$('#'+k).onchange=e=>{state[k]=e.target.value;render();};
  const subset=list().filter(r=>(state.arm==='all'||state.arm===r.arm)&&(state.seed==='all'||state.seed===String(r.seed))).sort((a,b)=>a[state.sort]-b[state.sort]);
  view.innerHTML='<p>'+subset.length+' matching experiments</p>'+table(['Run ID','Selected field L2','Adam steps','Evaluation set','Version'],subset.map(r=>[r.id,num(r.field_l2),r.adam_iteration,r.field_points,r.version]))+sel('Inspect experiment','detail',subset.map(r=>r.id),subset[0]?.id)+'<article id="detailView"></article>';
  const detail=()=>{const r=subset.find(x=>x.id===$('#detail').value);$('#detailView').innerHTML=r?facts([['Method',methods[r.arm]],['Origin',r.origin],['Evaluation',r.field_points],['Adam L2',num(r.adam_field_l2)],['L-BFGS evaluations',r.lbfgs_objective_evaluations],['L-BFGS time (s)',num(r.lbfgs_seconds_including_diagnostics)],['Source',r.file],['SHA-256',r.sourceSha256]]):'No matching runs.';};$('#detail').onchange=detail;detail();
}
async function fields(id) {
  const r=active(), p=catalog.pdes[state.eq], comp=state.component, tAxis=p.time_axis;
  const extra=sel('Output','component',p.outputs.map((k,i)=>[i,k]),comp);
  filters(true,true,extra);
  $('#component').onchange=e=>{state.component=Number(e.target.value);render();};
  view.innerHTML=(tAxis===null?'':'<div class="filters"><label>Time <output id="clock"></output><input id="time" type="range" min="0" max="100" value="'+Math.round(state.time*100)+'"></label><button id="play">Animate</button></div>')+
    '<p id="range" class="note">Loading selected weights…</p><div class="fields">'+['Analytic reference','PINN prediction','Absolute error','Relative error'].map((v,i)=>'<figure><canvas id="field'+i+'"></canvas><figcaption>'+v+'</figcaption></figure>').join('')+'</div><figure class="plot"><figcaption>Spatial section · analytic (green) and PINN (orange)</figcaption><canvas id="line"></canvas></figure>';
  const hosted=catalog.distribution==='results-only' && !models.has(r.id);
  if(!verified(r))throw Error('Awaiting numerical validation.');
  const saved=hosted?await request('./data/fields/'+encodeURIComponent(r.id)+'.json'):null;
  const fn=hosted?null:await load(r);if(epoch!==id)return;
  const n=saved?.n??25, aa=axes(state.eq,p), burgers=state.eq==='burgers';
  function draw(){
    const frame=saved?Math.round(state.time*(saved.times.length-1)):0;
    const fraction=saved&&!burgers?saved.times[frame]:state.time;
    const time=tAxis===null?0:p.domain[tAxis][0]+fraction*(p.domain[tAxis][1]-p.domain[tAxis][0]);
    if($('#clock'))$('#clock').value=num(time);
    const points=Array.from({length:n*n},(_,i)=>p.domain.map(([lo,hi],j)=>{
      if(j===tAxis && !burgers)return time;
      return lo+(hi-lo)*(j===0?i%n:Math.floor(i/n))/(n-1);
    }));
    const a=points.map(row=>exact(state.eq,row,p)[comp]), b=(saved?saved.frames[frame]:fn(points)).map(row=>row[comp]), err=a.map((v,i)=>Math.abs(v-b[i])), rel=err.map((v,i)=>Math.abs(a[i])<=1e-8?NaN:v/Math.abs(a[i]));
    const lo=Math.min(...a,...b),hi=Math.max(...a,...b), emax=Math.max(...err), rmax=Math.max(0,...rel.filter(Number.isFinite));
    [a,b,err,rel].forEach((values,i)=>heat($('#field'+i),values,n,i<2?lo:0,i<2?hi:i===2?emax:rmax));
    $('#range').textContent=(saved?'Stored field samples · ':'Derived live grid · ')+n+' × '+n+' · horizontal '+aa[0]+' / vertical '+aa[1]+' · '+p.outputs[comp]+' shared scale '+num(lo)+' to '+num(hi)+' · |error| 0–'+num(emax)+' · relative 0–'+num(rmax)+' (gray near reference zero)';
    const row=Math.round((burgers?state.time:0.5)*(n-1))*n;
    lines($('#line'),[a,b].map((v,i)=>({color:i?'#ce752d':'#197866',values:v.slice(row,row+n).map((y,j)=>[points[row+j][0],y])})),aa[0],p.outputs[comp]);
  }
  draw();if($('#time')){$('#time').oninput=e=>{state.time=+e.target.value/100;draw();};$('#play').onclick=()=>{
    if(interval){clearInterval(interval);interval=null;$('#play').textContent='Animate';}else{interval=setInterval(()=>{state.time=(Math.round(state.time*100)+5)%105/100;$('#time').value=Math.round(state.time*100);draw();},250);$('#play').textContent='Pause';}
  };}
}
function toolsPage(agent) {
  view.innerHTML=(agent?sel('Read-only tool','tool',[['compare','Compare methods'],['metrics','Experiment metrics'],['search','Search evidence']], 'compare'):'')+
    '<label>'+ (agent?'Equation, experiment ID or search query':'Search reports and experiment cards')+'<input id="query" value="heat2d" maxlength="512"></label><p><button id="go">'+(agent?'Run tool':'Search')+'</button></p><div id="results"></div>';
  let serial=0;
  $('#go').onclick=async()=>{const seq=++serial,target=$('#results'),query=$('#query').value.trim(),tool=agent?$('#tool').value:'search';
    target.textContent='Reading research records…';
    const args=tool==='compare'?{equation:query}:tool==='metrics'?{id:query}:{query};
    try{const result=await request('./api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,arguments:args})});
      if(seq!==serial||!target.isConnected)return;
      if(tool==='compare')target.innerHTML=table(['Method','Evaluation','n','Mean field L2','Sample variance'],result.groups.map(r=>[r.method,r.evaluation,r.n,num(r.mean),num(r.variance)]));
      else if(tool==='metrics')target.innerHTML=facts([['ID',result.id],['L2',result.field_l2],['Source',result.source],['Evaluation',result.evaluation]]);
      else target.innerHTML='<p class="note">'+esc(result.backend)+' · index '+esc(result.indexVersion)+(result.stale?' · prior index':'')+'</p>'+(result.results.map(h=>'<article><b>'+esc(h.id)+'</b><p>'+esc(h.text.slice(0,600))+'</p><small>'+esc(h.release)+' · '+esc(h.source)+'</small></article>').join('')||'No matching evidence.');
    }catch(e){if(seq===serial)target.textContent=e.message;}
  };$('#go').click();
}
async function importPage(){
  if(!session.owner){view.textContent='Import Center requires the signed-in Site owner.';return;}
  view.innerHTML='<article><h2>Stage a research run</h2><p>Choose a ZIP containing manifest.json and one data artifact, or select the two files separately. The artifact limit is 4 MiB. New weights require numerical validation before live inference.</p><label>ZIP or manifest<input id="manifest" type="file" accept=".zip,.json"></label><label>Artifact for a separate manifest<input id="artifact" type="file" accept=".json,.npz,.h5"></label><p><button id="dry">Dry run</button> <button id="approve" disabled>Approve registration</button></p><output id="out"></output></article>';
  let staged;
  if(catalog.distribution==='results-only')$('#out').textContent='Hosted imports accept a metrics JSON file containing up to 64 named finite numbers.';
  for(const el of [$('#manifest'),$('#artifact')])el.onchange=()=>{staged=null;$('#approve').disabled=true;};
  $('#dry').onclick=async()=>{try{staged=null;$('#approve').disabled=true;const f=$('#manifest').files[0];let m,b;
    if(!f)throw Error('Select a package.');
    if(f.name.endsWith('.zip')){const pack=await unpackPackage(f);m=pack.manifest;b=pack.bytes;}
    else {if(f.size>8192)throw Error('Manifest exceeds 8 KiB.');m=JSON.parse(await f.text());const a=$('#artifact').files[0];if(!a||a.name!==m.file||a.size>fileLimit)throw Error('Select the declared artifact, within 4 MiB.');b=new Uint8Array(await a.arrayBuffer());}
    if(await sha256(b)!==m.sourceSha256)throw Error('Artifact SHA-256 mismatch.');
    const info=await request('./api/import/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});
    $('#out').textContent=info.status+' · '+m.file+' · '+b.length+' bytes · SHA-256 '+m.sourceSha256;
    if(info.status==='new'){staged={m,b};$('#approve').disabled=false;}
  }catch(e){$('#out').textContent=e.message;}};
  $('#approve').onclick=async()=>{if(!staged)return;$('#approve').disabled=true;
    try{const {m,b}=staged;await request('./api/import/artifact/'+m.sourceSha256,{method:'PUT',body:b});await request('./api/import/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});
    await refresh();$('#out').textContent='Registered '+m.id+'. Model validation pending.';staged=null;
    }catch(e){$('#out').textContent=e.message;$('#approve').disabled=false;}};
}
async function refresh(){catalog=await request('./data/catalog.json');}
async function render(){
  const id=++epoch;clearInterval(interval);interval=null;
  const page=location.hash.slice(1)||'overview', name=navigation.find(([k])=>k===page)?.[1]??'Overview';
  $('#title').textContent=name;$('#section').textContent=Object.keys(groups).find(k=>groups[k].some(([p])=>p===page))??'Workspace';
  for(const a of document.querySelectorAll('nav a')){if(a.hash==='#'+page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  controls.innerHTML='';view.innerHTML='';
  const r=active(),p=catalog.pdes[state.eq],d=descriptions[state.eq];
  try{
  switch(page){
  case 'pdes':
    filters();view.innerHTML='<article><h2>'+esc(d[0])+'</h2><p>'+esc(d[2])+'</p>'+facts([['Governing equation',d[1]],['Initial condition',d[3]],['Boundary condition',p.boundary],['Input / train & evaluation domain',axes(state.eq,p).map((a,i)=>a+' ∈ ['+p.domain[i].map(num).join(', ')+']').join(' · ')],['Outputs',p.outputs.join(', ')],['Reference',p.note??'Manufactured analytic solution'],['Units','Original benchmark coordinates and fields']])+'</article>';break;
  case 'experiments':experiment(page);break;
  case 'comparison':case 'workspace':
    filters();view.innerHTML=table(['Method','Release','Evaluation','Seeds / runs','Mean field L2','Sample variance'],compare(catalog.runs,state.eq).map(g=>[methods[g.method],g.release,g.evaluation,g.n,num(g.mean),num(g.variance)]));
    if(page==='workspace'){view.innerHTML+='<div class="filters">'+['left','right'].map((k,i)=>sel('Experiment '+(i+1),k,list().map(x=>x.id),list()[i]?.id)).join('')+'</div><div id="pair"></div>';
      const pair=()=>{$('#pair').innerHTML=table(['Run','Evaluation','Seed','Adam steps','Adam L2','Selected L2'],['left','right'].map(k=>catalog.runs.find(v=>v.id===$('#'+k).value)).map(x=>[x.id,x.field_points,x.seed,x.adam_iteration,num(x.adam_field_l2),num(x.field_l2)]));};$('#left').onchange=$('#right').onchange=pair;pair();}break;
  case 'fields':await fields(id);break;
  case 'live':{
    filters(true,true);view.innerHTML='<article><p id="loaded">Loading '+esc(r.id)+'…</p><label>Physical coordinate batch · '+esc(axes(state.eq,p).join(', '))+'<textarea id="points" rows="3">'+JSON.stringify([p.domain.map(([a,b])=>(a+b)/2)])+'</textarea></label><p><button id="predict" disabled>Run inference</button></p><pre id="prediction"></pre></article>';
    const enable=fn=>{if(epoch!==id)return;$('#loaded').textContent='Verified weights loaded in this browser · '+r.id;$('#predict').disabled=false;$('#predict').onclick=()=>{try{$('#prediction').textContent=JSON.stringify(fn(JSON.parse($('#points').value)));}catch(e){$('#prediction').textContent=e.message;}};$('#predict').click();};
    if(!verified(r))throw Error('Model awaits numerical validation.');
    if(catalog.distribution==='results-only' && !models.has(r.id)){
      $('#loaded').textContent='Choose the matching converted JSON file from your device. It stays in this browser.';
      const picker=document.createElement('input');picker.type='file';picker.accept='.json';picker.setAttribute('aria-label','Local converted model');$('#loaded').after(picker);
      picker.onchange=async()=>{try{const f=picker.files[0];if(!f||f.size>2097152)throw Error('Invalid model file size.');
        const bytes=await f.arrayBuffer();if(await sha256(bytes)!==r.sha256)throw Error('Model SHA-256 mismatch.');
        const fn=compile(JSON.parse(new TextDecoder().decode(bytes)));if(epoch!==id)return;if(models.size>=3)models.delete(models.keys().next().value);models.set(r.id,fn);enable(fn);
      }catch(e){if(epoch===id)$('#prediction').textContent=e.message;}};
    }else enable(await load(r));break;}
  case 'training':
    filters(true,true);view.innerHTML='<figure class="plot"><figcaption>'+esc(r.lossLabel??'No stored loss history')+'</figcaption><canvas id="loss"></canvas></figure><figure class="plot"><figcaption>Validation relative L2</figcaption><canvas id="vl"></canvas></figure>'+facts([['Method',methods[r.arm]],['Adam iterations',r.adam_iteration],['L-BFGS evaluations',r.lbfgs_objective_evaluations],['Stored reference grid',r.field_points]]);
    [1,2].forEach((j,i)=>lines($(i?'#vl':'#loss'),[{values:r.series.map(t=>[t[0],t[j]]),color:'#167967'}],'Adam iteration',i?'Validation L2':r.lossLabel));break;
  case 'inverse':view.innerHTML=table(['Run','Coefficient','Estimated','Target','Stored relative error'],catalog.runs.filter(x=>x.lambda_error!==null).map(x=>[x.id,x.equation==='wave2d'?'λ':'ν',num(x.coefficient),x.equation==='wave2d'?1:0.025,num(x.lambda_error)]));break;
  case 'models':case 'artifacts':filters(true,true);view.innerHTML='<article>'+facts([['Immutable run',r.id],['Version',r.version],['Architecture',r.kind+' · '+r.layerWidths.join(' → ')],['Model source',r.file],['Selected weights SHA-256',r.sourceSha256],['Browser conversion SHA-256',r.sha256],['Outputs',p.outputs.join(', ')],['Evaluation set',r.field_points],['Validation',verified(r)?'Passed':'Pending'],['Cache on this device',models.has(r.id)?'Loaded':'On demand'],['Initial selection','heat2d-baseline-3234']])+'</article>';break;
  case 'rag':case 'agent':view.innerHTML='';toolsPage(page==='agent');break;
  case 'import':await importPage();break;
  case 'releases':view.innerHTML=table(['Release','Runs','Origin'],[...new Set(catalog.runs.map(x=>x.version))].map(v=>[v,catalog.runs.filter(x=>x.version===v).length,v===catalog.release?'Pinned selected weights':'Owner registration']));break;
  case 'validation':view.innerHTML='<p>36 physical coordinates per converted model. Elementwise tolerance |JS − TF| ≤ 10⁻⁵ + 10⁻⁴ |TF|.</p>'+table(['Run','Status','Maximum absolute difference'],catalog.runs.map(x=>[x.id,verified(x)?'Passed':'Pending',num(validation.models[x.id]?.maximum)]));break;
  case 'api':view.innerHTML='<article><h2>Sites adapter</h2><p>GET /api/health · /data/catalog.json · /data/validation.json · /api/session. Structured research queries use POST /api/research. Supply tool and arguments for search, compare, metrics or predict.</p><h2>Original Python service</h2><p>Launch the pinned release in Colab or the local FastAPI launcher. Its OpenAPI contract includes /models, /model/info, /predict/batch, /rag/search and /agent/tool.</p></article>';break;
  case 'engineering':view.innerHTML='<article>'+facts([['Baseline',catalog.source],['Runtime','Browser ES modules · Float32 weights · Sites Worker'],['Registry','Immutable release runs + owner-approved research records'],['Retrieval','BM25 over saved reports and versioned model cards'],['Agent','Structured read-only tools'],['Validation','TensorFlow CPU output and analytic reference at fixed coordinates']])+'<a href="https://github.com/danny97041/online-pinn-pde-framework/tree/v3.0.4">Original V3 release source</a></article>';break;
  default:{
    const intro=catalog.pdes.wave2d,n=64,values=[];for(let j=0;j<n;j++)for(let i=0;i<n;i++)values.push(exact('wave2d',[-1+2*i/(n-1),2*j/(n-1),0],intro)[0]);
    view.innerHTML='<div class="hero"><div><h2>Online PINN PDE Framework V3</h2><p>Explore saved experiments and compare learned fields against analytic solutions.</p><a href="#fields">Explore a field</a></div><figure><canvas id="hero"></canvas><figcaption>Wave displacement · analytic reference, t = 0</figcaption></figure></div><div class="cards">'+[['PDE configurations',Object.keys(catalog.pdes).length],['Stored experiments',catalog.runs.length],['Verified models',Object.values(validation.models).filter(x=>x.verified).length]].map(([k,v])=>'<div class="card">'+esc(k)+'<strong>'+v+'</strong></div>').join('')+'</div><h2>Experiment coverage</h2>'+table(['Equation','Saved runs','Output fields','Seeds'],Object.entries(catalog.pdes).map(([k,v])=>[descriptions[k][0],list(k).length,v.outputs.join(', '),[...new Set(list(k).map(x=>x.seed))].join(', ')]));heat($('#hero'),values,n,-1,1);}
  }
  }catch(e){if(epoch===id){const err=document.createElement('p');err.className='error';err.textContent=e.message;view.prepend(err);}}
}
try{await refresh();[validation,session]=await Promise.all([request('./data/validation.json'),request('./api/session')]);window.onhashchange=render;await render();}
catch(e){view.textContent='Research data could not be loaded. '+e.message;}

