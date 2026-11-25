import {validatePoints} from './contract.mjs';

function unpack(t, rank) {
  if (t.shape?.length !== rank || !t.shape.every(n => Number.isInteger(n) && n > 0 && n <= 1024))
    throw new Error('Unsupported tensor shape');
  const size = t.shape.reduce((a,b) => a*b, 1);
  if (typeof t.data !== 'string' || t.data.length !== Math.ceil(size*4/3)*4) throw new Error('Invalid tensor length');
  const bytes = Uint8Array.from(atob(t.data), c => c.charCodeAt(0));
  if (bytes.length !== size*4) throw new Error('Incomplete tensor');
  const values = new Float32Array(bytes.buffer);
  if (!values.every(Number.isFinite)) throw new Error('Nonfinite tensor');
  return {values, width:t.shape.at(-1), height:t.shape[0]};
}
function multiply(x, m, bias, activate) {
  if (x.length !== m.height) throw new Error('Incompatible matrix');
  const y = new Float64Array(m.width);
  for (let i=0; i<x.length; i++) {
    const offset = i*m.width, input=x[i];
    for (let j=0; j<y.length; j++) y[j] += input*m.values[offset+j];
  }
  for (let j=0;j<y.length;j++) {
    const v = Math.fround(y[j] + (bias?.values[j] ?? 0));
    y[j] = activate ? Math.fround(Math.tanh(v)) : v;
  }
  return y;
}
function features(input, bank) {
  const phase = multiply(input,bank);
  const angles = Array.from(phase,v => Math.fround(Math.fround(2*Math.PI)*v));
  return [...angles.map(Math.sin), ...angles.map(Math.cos)].map(Math.fround);
}
export function compile(data) {
  const {domain,kind} = data;
  if (data.format !== 'physicsai.v1' || !['plain','fourier','spacetime'].includes(kind) ||
      !Array.isArray(domain) || ![2,3].includes(domain.length) ||
      !domain.every(pair=>Array.isArray(pair) && pair.length===2 && pair.every(Number.isFinite) && pair[0]<pair[1]) ||
      !Array.isArray(data.layers) || data.layers.length<2 || data.layers.length>10 ||
      !Array.isArray(data.banks) || data.banks.length>12) throw new Error('Unsupported architecture');
  const layers=data.layers.map(([kernel,bias])=>{
    const m=unpack(kernel,2), b=unpack(bias,1);
    if (m.width!==b.width) throw new Error('Bias width mismatch');
    return [m,b];
  });
  const banks=data.banks.map(b=>unpack(b,2));
  if ((kind==='plain') !== (banks.length===0) || (kind==='spacetime' && (domain.length!==3 || banks.length%2)))
    throw new Error('Invalid Fourier banks');
  const output=layers.pop();
  function trunk(values) {
    for (const [matrix,bias] of layers) values=multiply(values,matrix,bias,true);
    return values;
  }
  return points=>validatePoints(points,domain).map(row=>{
    const z=row.map((v,j)=>Math.fround(2*Math.fround(Math.fround(v)-Math.fround(domain[j][0]))/Math.fround(domain[j][1]-domain[j][0])-1));
    let h;
    if (kind==='plain') h=trunk(z);
    else if (kind==='fourier') h=trunk(banks.flatMap(b=>features(z,b)));
    else {
      const count=banks.length/2;
      const space=banks.slice(0,count).map(b=>trunk([z[0],z[1],0,...features(z.slice(0,2),b)]));
      const time=banks.slice(count).map(b=>trunk([0,0,z[2],...features(z.slice(2),b)]));
      h=space.flatMap(s=>time.flatMap(t=>Array.from(s,(v,i)=>Math.fround(v*t[i]))));
    }
    const y=Array.from(multiply(h,...output,false));
    if (!y.every(Number.isFinite)) throw new Error('Nonfinite prediction');
    return y;
  });
}
export async function sha256(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function loadModel(run) {
  const response=await fetch('./data/models/'+encodeURIComponent(run.id)+'.json');
  if (!response.ok) throw new Error('Model could not be loaded');
  const bytes=await response.arrayBuffer();
  if (await sha256(bytes)!==run.sha256) throw new Error('Weight checksum mismatch');
  return compile(JSON.parse(new TextDecoder().decode(bytes)));
}
