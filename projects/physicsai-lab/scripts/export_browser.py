"""Convert the pinned, verified private V3 release to data-only browser artifacts."""
import argparse
import base64
import hashlib
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

from audit_v3 import audit, digest
from smoke_v3 import RELEASE_COMMIT


def save(path, obj):
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    path.write_bytes(data)
    return digest(data)


def export(source, bundle, dest):
    if subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip() != RELEASE_COMMIT:
        raise ValueError("Required pinned release")
    if subprocess.check_output(["git", "-C", source, "status", "--porcelain", "--", "v3"], text=True).strip():
        raise ValueError("Modified source")
    audit(bundle)
    sys.path.insert(0, str(source.resolve()))
    import numpy as np
    from v3 import context
    rt = context()
    candidate = rt["load_candidate_runtime"]()
    wave = rt["load_wave_inference"]()
    dest.mkdir(parents=True, exist_ok=True)
    models = dest / "models"
    models.mkdir(exist_ok=True)

    def tensor(array):
        arr = np.asarray(array, dtype="<f4")
        if not np.isfinite(arr).all():
            raise ValueError("Nonfinite tensor")
        return {"shape": list(arr.shape), "data": base64.b64encode(arr.tobytes()).decode()}

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "release"
        rt["release_open"](bundle, root)
        config, _, contract, _ = wave["audit_inputs"](root/"inputs/wave_source.zip", root/"inputs/wave_parent.zip")
        pdes = {k:dict(v) for k,v in candidate["CANDIDATES"].items()}
        pdes["wave2d"] = {"domain":[[config["domain"][k+"_min"], config["domain"][k+"_max"]] for k in "xyt"],
                          "outputs":["u"], "time_axis":2, "boundary":"homogeneous Dirichlet",
                          "wave":config["equation"]}
        module_uri = (Path(__file__).resolve().parents[1] / "web/contract.mjs").as_uri()
        program = "import {probePoints} from " + json.dumps(module_uri) + "; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(probePoints)))"
        probes = json.loads(subprocess.check_output(["node","--input-type=module","-e",program,
            json.dumps([p["domain"] for p in pdes.values()])],text=True))
        points = dict(zip(pdes, probes))
        rows = json.loads((root/"summary.json").read_text())["rows"]
        full_policy = json.loads((root/"contract.json").read_text())["policy"]
        references = {}
        with ZipFile(root/"inputs/wave_parent.zip") as parent:
            for row in rows:
                eq, arm, seed = (row[k] for k in ("equation","arm","seed"))
                component = f"seed_{seed}_{arm}"
                identifier = f"{eq}-{arm}-{seed}"
                if eq == "wave2d":
                    member = f"postprocess/trials/{component}/selected.weights.h5"
                    model = wave["audit_load_model"](config,contract,arm,seed,parent,member,tmp)
                    layers = [*model.hidden_layers, model.output_layer]
                    banks = getattr(model,"ff_banks",[])
                    kind = getattr(model,"ff_kind","plain")
                    coefficient = float(model.lambda_1.numpy())
                    raw_digest = digest(parent.read(member))
                    source_path = "inputs/wave_parent.zip!/" + member
                    history = json.loads(parent.read(f"trials/{component}/result.json"))["history"]
                    series = [[h["iteration"], h["weighted_train_objective"], h["validation_metrics"]["relative_l2"]] for h in history]
                    label = "Weighted training objective"
                    expected = wave["audit_exact"](np.array(points[eq]),config)["u"][:,None]
                else:
                    member = f"candidates/{eq}/{component}/selected_weights.npz"
                    model = candidate["cu_state"](eq,arm,seed)[0]
                    candidate["cu_load_weights"](model,root/member)
                    layers = [*model.hidden,model.out]
                    banks = model.ff
                    kind = "fourier" if banks else "plain"
                    coefficient = float(model.coefficient.numpy()) if eq == "kovasznay_inverse" else None
                    raw_digest = digest((root/member).read_bytes())
                    source_path = member
                    result = json.loads((root/member).with_name("result.json").read_text())
                    series = [[h["iteration"],h["validation_normalized_groups"][0],h["validation_l2"]] for h in result["history"]]
                    label = "Validation normalized group 0"
                    expected = candidate["candidate_field"](eq,np.array(points[eq]))
                weights = {"format":"physicsai.v1","kind":kind,"domain":pdes[eq]["domain"],
                           "banks":[tensor(b.numpy()) for b in banks],
                           "layers":[[tensor(a) for a in layer.get_weights()] for layer in layers]}
                model_sha = save(models/(identifier+".json"),weights)
                actual = model(np.asarray(points[eq],np.float32),training=False).numpy()
                references[identifier] = {"prediction":actual.tolist(),"exact":expected.tolist()}
                row.update(id=identifier,version="v3.0.4",file=source_path,sourceSha256=raw_digest,
                           sha256=model_sha,kind=kind,layerWidths=[int(l.units) for l in layers],
                           coefficient=coefficient,series=series,lossLabel=label)
        documents = []
        for path in [root/"REPORT.md", *sorted((root/"generated_documents").glob("*.md"))]:
            content = path.read_text(encoding="utf-8")
            documents.append({"id":path.stem,"text":content,"sha256":digest(path.read_bytes())})
        save(dest/"catalog.json",{"format":"physicsai.v1","release":"v3.0.4","source":RELEASE_COMMIT,
            "pdes":pdes,"runs":rows,"policy":full_policy, "documents":documents,
            "retrieval":json.loads((root/"rag_artifacts/e5_embeddings.json").read_text())})
        save(dest/"reference.json",references)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("source","bundle","dest"):
        parser.add_argument(key,type=Path)
    args = parser.parse_args()
    export(args.source,args.bundle,args.dest)

