import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, linkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const blockSize=4096;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inspect(path,expected){
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const binding=db.prepare('SELECT realm,stage FROM instance_binding WHERE singleton=1').get();
    if(!binding || (expected&&(binding.realm!==expected.realm||binding.stage!==expected.stage)))
      throw Error('Recovery binding mismatch');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get())
      throw Error('Recovery snapshot integrity check failed');
    return binding;
  } finally {db.close();}
}
export function snapshot(db,target,base){
  target=resolve(target);
  if(existsSync(target)) throw Error('Backup destination already exists');
  const work=mkdtempSync(join(dirname(target),'.careerops-backup-'));
  try {
    const path=join(work,'snapshot.sqlite');
    db.prepare('VACUUM INTO ?').run(path);
    const binding=inspect(path);
    if(!base) {linkSync(path,target);return {binding,sha256:hash(readFileSync(path))};}
    inspect(base,binding);
    const old=readFileSync(base), next=readFileSync(path),blocks=[];
    for(let i=0;i<next.length;i+=blockSize){
      const block=next.subarray(i,i+blockSize);
      if(!block.equals(old.subarray(i,i+block.length))) blocks.push([i,block.toString('base64')]);
    }
    const delta={version:1,binding,baseHash:hash(old),sha256:hash(next),size:next.length,blocks};
    writeFileSync(target,JSON.stringify(delta),{flag:'wx',mode:0o600});
    return {binding,sha256:delta.sha256,changedBlocks:blocks.length};
  } finally {rmSync(work,{recursive:true,force:true});}
}
export function restore(base,target,binding,deltaPath){
  target=resolve(target);
  if(existsSync(target)) throw Error('Restore destination already exists');
  inspect(base,binding);
  const old=readFileSync(base);
  let data=old;
  if(deltaPath){
    const delta=JSON.parse(readFileSync(deltaPath,'utf8'));
    if(delta.version!==1||delta.baseHash!==hash(old)||delta.binding?.realm!==binding.realm||delta.binding?.stage!==binding.stage||
       !Number.isSafeInteger(delta.size)||delta.size<512||delta.size>1024**3||!Array.isArray(delta.blocks))
      throw Error('Invalid incremental backup or base');
    data=Buffer.alloc(delta.size);
    old.copy(data);
    const seen=new Set();
    for(const [offset,base64] of delta.blocks){
      if(!Number.isSafeInteger(offset)||offset<0||offset%blockSize||offset>=data.length||seen.has(offset)) throw Error('Invalid incremental block');
      const block=Buffer.from(base64,'base64');
      if(block.length!==Math.min(blockSize,data.length-offset)) throw Error('Invalid incremental block length');
      seen.add(offset);block.copy(data,offset);
    }
    if(hash(data)!==delta.sha256) throw Error('Incremental backup checksum mismatch');
  }
  const work=mkdtempSync(join(dirname(target),'.careerops-recovery-'));
  try {
    const path=join(work,'restored.sqlite');
    const fd=openSync(path,'wx',0o600);
    try {writeFileSync(fd,data);} finally {closeSync(fd);}
    inspect(path,binding);
    linkSync(path,target);
    return {binding,sha256:hash(data)};
  } finally {rmSync(work,{recursive:true,force:true});}
}
