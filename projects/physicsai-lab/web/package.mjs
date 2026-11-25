export const fileLimit=4*1024*1024;
export async function bounded(body,max) {
  if (!body) throw Error('Empty body');
  const reader=body.getReader(), chunks=[]; let size=0;
  for (;;) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.length;
    if (size>max) {await reader.cancel();throw Error('Size limit exceeded');}
    chunks.push(value);
  }
  const out=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) {out.set(chunk,offset);offset+=chunk.length;}
  return out;
}
// Read the tail and central directory first. Only two data entries are admitted.
export async function unpackPackage(file) {
  if (file.size>fileLimit+65536 || file.size<22) throw Error('Package exceeds the supported upload range.');
  const tail=new DataView(await file.slice(-22).arrayBuffer());
  if(tail.getUint32(0,true)!==0x06054b50 || tail.getUint32(4,true)!==0 ||
    tail.getUint16(8,true)!==2 || tail.getUint16(10,true)!==2 || tail.getUint16(20,true)!==0) throw Error('Expected a single-volume ZIP with two files.');
  const length=tail.getUint32(12,true), start=tail.getUint32(16,true);
  if(length>1024 || start+length!==file.size-22) throw Error('Invalid ZIP directory.');
  const directory=new Uint8Array(await file.slice(start,start+length).arrayBuffer()), d=new DataView(directory.buffer);
  const decoder=new TextDecoder('utf-8',{fatal:true}), files=new Map();
  let i=0, total=0;
  for(let entry=0;entry<2;entry++) {
    if(i+46>d.byteLength || d.getUint32(i,true)!==0x02014b50) throw Error('Invalid ZIP entry.');
    const flags=d.getUint16(i+8,true), method=d.getUint16(i+10,true), packed=d.getUint32(i+20,true), size=d.getUint32(i+24,true);
    const nameLen=d.getUint16(i+28,true), offset=d.getUint32(i+42,true);
    const name=decoder.decode(directory.slice(i+46,i+46+nameLen));
    i+=46+nameLen+d.getUint16(i+30,true)+d.getUint16(i+32,true);
    total+=size;
    if ((flags&~0x800)!==0 || ![0,8].includes(method) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.(json|npz|h5)$/.test(name) ||
        files.has(name) || total>fileLimit+8192 || size>(name==='manifest.json'?8192:fileLimit)) throw Error('Unsupported entry.');
    const head=new DataView(await file.slice(offset,offset+30).arrayBuffer());
    if(head.getUint32(0,true)!==0x04034b50 || head.getUint16(6,true)!==flags || head.getUint16(8,true)!==method) throw Error('Inconsistent local header.');
    const nameStart=offset+30, localEnd=nameStart+head.getUint16(26,true), dataStart=localEnd+head.getUint16(28,true);
    if(decoder.decode(await file.slice(nameStart,localEnd).arrayBuffer())!==name || dataStart+packed>start) throw Error('Invalid ZIP range.');
    let stream=file.slice(dataStart,dataStart+packed).stream();
    if(method===8) stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const bytes=await bounded(stream,size);
    if(bytes.length!==size) throw Error('Invalid expanded size.');
    files.set(name,bytes);
  }
  if(i!==length || !files.has('manifest.json')) throw Error('Missing manifest.');
  const manifest=JSON.parse(decoder.decode(files.get('manifest.json')));
  if(manifest.file==='manifest.json' || !files.has(manifest.file)) throw Error('Missing declared artifact.');
  return {manifest,bytes:files.get(manifest.file)};
}
