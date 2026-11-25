"""Compare exact inner-product rankings on saved E5 vectors. No query encoder is invoked."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZipFile

from audit_v3 import RELEASE_SHA256

def check(bundle):
    import faiss
    import numpy as np
    with bundle.open("rb") as handle:
        if hashlib.file_digest(handle,"sha256").hexdigest()!=RELEASE_SHA256:
            raise ValueError("Expected pinned release")
    with ZipFile(bundle) as z:
        meta=json.loads(z.read("rag_artifacts/e5_embeddings.json"))
        data=z.read("rag_artifacts/e5_embeddings.npz")
    if hashlib.sha256(data).hexdigest()!=meta["embeddings_sha256"]:
        raise ValueError("Embedding checksum mismatch")
    with np.load(io.BytesIO(data),allow_pickle=False) as archive:
        vectors=archive["embeddings"]
    assert vectors.shape==(meta["count"],meta["dimension"]) and np.isfinite(vectors).all()
    index=faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)
    probes=vectors[np.linspace(0,len(vectors)-1,32,dtype=int)]
    scores,ids=index.search(probes,5)
    expected=np.sort(probes@vectors.T,axis=1)[:,-5:][:,::-1]
    difference=float(np.max(np.abs(scores-expected)))
    assert difference<=1e-5 and (ids>=0).all()
    return {"matrix_shape":list(vectors.shape),"queries":len(probes),"k":5,
            "score_max_abs_difference":difference,"mode":"stored-vector exact IP; tied IDs may differ",
            "query_encoder_executed":False}

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("bundle",type=Path)
    p.add_argument("output",type=Path)
    a=p.parse_args()
    result=check(a.bundle)
    a.output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(result)

