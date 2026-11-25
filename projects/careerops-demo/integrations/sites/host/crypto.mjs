import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
export const randomUUID=()=>crypto.randomUUID();
export function createHash(name){
  if(name!=='sha256') throw Error('Unsupported digest');
  const h=sha256.create();
  return {update(value){h.update(typeof value==='string'?new TextEncoder().encode(value):value);return this;},
    digest(format){const bytes=h.digest();return format==='hex'?bytesToHex(bytes):bytes;}};
}
export function timingSafeEqual(a,b){
  if(a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a[i]^b[i];
  return diff===0;
}
