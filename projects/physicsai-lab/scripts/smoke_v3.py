"""Load official V3 models using an explicitly selected trusted release checkout."""

import argparse
import importlib.metadata
import json
import sys
import tempfile
from pathlib import Path

from audit_v3 import audit

RELEASE_COMMIT = "374051dc307aa0a66b58e6816c7e97e6dbbfe9b7"


def smoke(source, bundle, full, scratch):
    import subprocess

    sha = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--", "v3"], text=True)
    if sha != RELEASE_COMMIT or tree.strip():
        raise ValueError("Use a clean v3.0.4 checkout")
    audit(bundle)
    sys.path.insert(0, str(source.resolve()))
    import numpy as np
    from fastapi.testclient import TestClient
    from v3 import context

    runtime = context()
    assert "tensorflow" not in sys.modules
    with tempfile.TemporaryDirectory(prefix="v3-audit-", dir=scratch) as temp:
        root = Path(temp) / "release"
        runtime["release_open"](bundle, root)
        agent, app = runtime["release_services"](root, use_llm=False, dense_rag=False)
        assert "tensorflow" not in sys.modules
        with TestClient(app) as client:
            routes = client.get("/openapi.json").json()["paths"]
            models = client.get("/models")
            assert models.status_code == 200
            payload = models.json()
            models = payload if isinstance(payload, list) else payload["models"]
            assert len(models) == 65
            cases = models if full else [m for m in models if m["arm"] in {"baseline", "ff"}
                                         and m["seed"] == 3234]
            measurements, failed = [], []
            for model in cases:
                equation, arm, seed = (model[k] for k in ("equation", "arm", "seed"))
                lo, hi = np.asarray(model["domain"], dtype=float).T
                points = [((hi-lo)*x+lo).tolist() for x in (0.19, 0.5, 0.83)]
                try:
                    batch = np.asarray(agent.predictor(equation, arm, seed, points)["prediction"], dtype=float)
                    single = np.asarray(agent.predictor(equation, arm, seed, points[1:2])["prediction"], dtype=float)
                    assert batch.shape == (3, model["output_dimension"]) and np.isfinite(batch).all()
                    np.testing.assert_allclose(single[0], batch[1], atol=1e-5, rtol=1e-4)
                    measurements.append(float(np.max(np.abs(single[0] - batch[1]))))
                except (AssertionError, RuntimeError, ValueError, OSError, ImportError) as exc:
                    failed.append({"equation": equation, "arm": arm, "seed": seed, "error": type(exc).__name__,
                                   "reason": str(exc)[:300]})
            example = {"equation": "heat2d", "arm": "baseline", "seed": 3234, "points": [[0.2, 0.3, 0.1]]}
            r = client.post("/predict/batch", json=example)
            checks = {
                "health": client.get("/health").status_code,
                "comparison": client.get("/comparison", params={"equation": "heat2d"}).status_code,
                "batch_predict": r.status_code,
                "outside_domain": client.post("/predict", json={**example, "points": [[1e6, 0, 0]]}).status_code,
                "extra_field": client.post("/predict", json={**example, "extra": 1}).status_code,
                "disabled_registry": client.post("/registry/activate", json={
                    "equation": "heat2d", "arm": "baseline", "seed": 3234, "approved": True}).status_code,
                "keyword_retrieval": client.post("/rag/search", json={"query": "heat2d", "k": 3}).status_code,
            }
            assert checks == {"health": 200, "comparison": 200, "batch_predict": 200, "outside_domain": 422,
                              "extra_field": 422, "disabled_registry": 403, "keyword_retrieval": 200}, checks
            return {"commit": sha, "routes": sorted(routes), "probe_points": len(points),
                    "models_attempted": len(cases), "models_passed": len(measurements),
                    "max_batch_single_delta": max(measurements, default=None), "failures": failed, "api": checks,
                    "runtime": {name: importlib.metadata.version(name) for name in
                                ("numpy", "tensorflow", "keras", "fastapi", "pydantic", "httpx", "scipy")}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--scratch", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    outcome = smoke(args.source, args.bundle, args.all, args.scratch)
    result = json.dumps(outcome, indent=2) + "\n"
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    print(result, end="")
    raise SystemExit(bool(outcome["failures"]))
