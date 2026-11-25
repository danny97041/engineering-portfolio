// Keep the last complete index live while preparing changed postings.
const tokenize=text=>text.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];
export function createIndexCache(){
  let active;
  return function index(catalog){
    const version=catalog.release+'/'+catalog.revision;
    if(active?.version===version)return active;
    const docs=new Map(), postings=new Map(active?.postings), touched=new Set();
    let changed=0,total=0;
    function posting(term){
      if(!touched.has(term)){postings.set(term,new Map(postings.get(term)));touched.add(term);}
      return postings.get(term);
    }
    function insert(doc){
      if(docs.has(doc.id) || !doc.sha256 || typeof doc.text!=='string')throw Error('Invalid evidence document');
      const old=active?.docs.get(doc.id);
      if(old && old.sha256===doc.sha256 && old.release===doc.release && old.text===doc.text){docs.set(doc.id,old);total+=old.length;return;}
      if(old)for(const term of old.counts.keys())posting(term).delete(doc.id);
      const words=tokenize(doc.id+' '+doc.text),counts=new Map();
      for(const word of words)counts.set(word,(counts.get(word)??0)+1);
      for(const [word,n] of counts)posting(word).set(doc.id,n);
      docs.set(doc.id,{...doc,length:words.length,counts});total+=words.length;changed++;
    }
    try{
      for(const doc of catalog.documents){
        doc.text.split(/\n\s*\n/).filter(Boolean).forEach((text,i)=>insert({id:'doc/'+doc.id+'/'+i,source:doc.id,sha256:doc.sha256,text,release:catalog.release}));
      }
      for(const r of catalog.runs)insert({id:r.id,source:r.file,sha256:r.sourceSha256,release:r.version,
        text:[r.equation,r.arm,'seed',r.seed,'field_l2',r.field_l2,'evaluation',r.field_points,'Adam iterations',r.adam_iteration].join(' ')});
      if(active)for(const [id,doc] of active.docs)if(!docs.has(id))for(const term of doc.counts.keys())posting(term).delete(id);
      function search(query,k=5){
        if(typeof query!=='string' || !query.trim() || query.length>512 || !Number.isInteger(k) || k<1 || k>20)throw Error('Invalid query');
        const scores=new Map();
        for(const term of new Set(tokenize(query))){
          const hits=postings.get(term);if(!hits?.size)continue;
          const idf=Math.log(1+(docs.size-hits.size+0.5)/(hits.size+0.5));
          for(const [id,count] of hits){const norm=1.2*(0.25+0.75*docs.get(id).length*docs.size/total);
            scores.set(id,(scores.get(id)??0)+idf*count*2.2/(count+norm));}
        }
        return [...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,k).map(([id,score])=>{
          const {source,sha256,text,release}=docs.get(id);return {id,source,sha256,text,release,score};
        });
      }
      active={version,docs,postings,changed,search,stale:false};return active;
    }catch(e){if(!active)throw e;return {...active,stale:true};}
  };
}
