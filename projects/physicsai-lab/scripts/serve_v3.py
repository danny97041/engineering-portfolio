"""Run the unmodified, pinned upstream FastAPI service on loopback or check its routes."""
import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from audit_v3 import audit
from smoke_v3 import RELEASE_COMMIT


def exercise(app, root):
    from fastapi.testclient import TestClient
    checks = {}
    key = {"equation":"heat2d","arm":"baseline","seed":3234}
    q = {"query":"heat2d baseline relative L2","k":3}
    coordinates = {**key,"points":[[0.2,0.3,0.1]]}
    with TestClient(app) as c:
        def call(route, expected=200, body=None, params=None):
            response = c.get(route, params=params) if body is None else c.post(route, json=body)
            checks[route]=response.status_code
            if response.status_code != expected:
                raise ValueError(f"{route} returned {response.status_code}")
            return response.json()
        call("/health")
        assert len(call("/models")["models"])==65
        info = call("/model/info",params=key)
        assert info["checkpoint_available"] and len(info["checkpoint_sha256"])==64
        assert len(call("/report")["rows"])==65
        call("/comparison",params={"equation":"heat2d"})
        first=call("/predict", body=coordinates)
        assert first==call("/predict/batch",body=coordinates)
        hits=call("/rag/search",body=q)
        assert len(hits["results"])==3
        evidence=call("/rag/context",body={**q,"max_characters":1200})
        assert evidence["evidence"] and len(evidence["context"])<=1200
        call("/agent/tool",body={"tool":"compare","arguments":{"equation":"heat2d"}})
        call("/agent/ask",body={"question":"heat2d 방법 비교"})
        assert call("/registry")["active"]=={}
        call("/predict/active",422,body={"equation":"heat2d","points":coordinates["points"]})
        call("/registry/activate",403,body={**key,"approved":True})
    meta=json.loads((root/"rag_artifacts/e5_embeddings.json").read_text())
    return {"upstream":RELEASE_COMMIT,"route_status":checks,"backend":hits["backend"],
            "hybrid_artifact":{k:meta[k] for k in ("count","dimension","semantic_weight","keyword_weight","rrf_k")},
            "installed":{k:bool(importlib.util.find_spec(k)) for k in ("faiss","transformers","torch","uvicorn")},
            "real_llm":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("bundle",type=Path)
    parser.add_argument("--check",type=Path)
    parser.add_argument("--port",type=int,default=8127)
    args=parser.parse_args()
    if subprocess.check_output(["git","-C",args.source,"rev-parse","HEAD"],text=True).strip()!=RELEASE_COMMIT:
        raise ValueError("Unexpected source revision")
    if subprocess.check_output(["git","-C",args.source,"status","--porcelain","--","v3"],text=True).strip():
        raise ValueError("Modified source modules")
    audit(args.bundle)
    sys.path.insert(0,str(args.source.resolve()))
    from v3 import context
    rt=context()
    with tempfile.TemporaryDirectory(prefix="physicsai-api-") as tmp:
        root=Path(tmp)/"release"
        rt["release_open"](args.bundle,root)
        _,app=rt["release_services"](root,use_llm=False,dense_rag=False)
        if args.check:
            result=exercise(app,root)
            args.check.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
            print(json.dumps(result))
        else:
            import uvicorn
            uvicorn.run(app,host="127.0.0.1",port=args.port)

if __name__=="__main__":
    main()

