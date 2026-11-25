"""Audit a verified V3 release without extracting or executing its ZIP contents."""

import argparse
import csv
import hashlib
import io
import json
import math
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

RELEASE_SHA256 = "311d0756d342d442e33f4003a30e795a1e7f1bf06c8d408bf3783b62d4b0bfcf"
METHODS = {"baseline", "loss_sa", "ff", "ff_loss_sa", "ff_curriculum"}
SEEDS = {
    "wave2d": {3234, 3235, 3236},
    "heat2d": {3234, 3235, 3236},
    **dict.fromkeys(
        ("poisson2d", "burgers", "darcy2d", "reaction_diffusion",
         "kovasznay_forward", "kovasznay_inverse", "taylor_green"),
        {3234},
    ),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit(bundle):
    with bundle.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    require(checksum == RELEASE_SHA256, "Expected the official v3.0.4 release ZIP")
    with ZipFile(bundle) as archive:
        read = lambda name: json.loads(archive.read(name))
        require(archive.testzip() is None, "Archive CRC failed")
        names = archive.namelist()
        require(len(set(names)) == len(names), "Repeated ZIP member")
        manifest = read("unified_manifest.json")["files"]
        require(set(manifest) == set(names) - {"unified_manifest.json"}, "Manifest member coverage differs")
        for name, expected in manifest.items():
            require(digest(archive.read(name)) == expected, f"Manifest digest mismatch for {name}")
        contract = read("contract.json")
        require(contract["distribution_format"] == "v3-two-file-1", "Unknown contract")
        summary = read("summary.json")
        rows = summary["rows"]
        grouped = defaultdict(list)
        for row in rows:
            grouped[row["equation"], row["arm"]].append(row)
        require(set(grouped) == {(p, m) for p in SEEDS for m in METHODS}, "PDE/method matrix")
        for (equation, method), group in grouped.items():
            require({r["seed"] for r in group} == SEEDS[equation] and len(group) == len(SEEDS[equation]),
                    f"Wrong seed matrix for {equation}/{method}")
        require(len(rows) == summary["completed_trials"] == 65, "Expected 65 experiments")
        pairs = list(csv.DictReader(io.StringIO(archive.read("comparison.csv").decode("utf-8-sig"))))
        require(len(pairs) == len(grouped) == 45, "Wrong CSV group count")
        for row in pairs:
            group = grouped[row["equation"], row["arm"]]
            mean = sum(r["field_l2"] for r in group) / len(group)
            require(int(row["n"]) == len(group) and math.isclose(float(row["field_l2_mean"]), mean, rel_tol=1e-12),
                    "CSV disagrees with summary")
        source = read("provenance/distribution_source.json")["files"]
        for name, expected in source.items():
            require(digest(archive.read(f"source_snapshot/{name}")) == expected,
                    f"Source digest mismatch for {name}")
        validation = read("validation/status.json")
        record_digests = {
            name: digest(archive.read(f"validation/{name}")) == status["sha256"]
            for name, status in validation["checks"].items()
        }
        weights = {"HDF5": 0, "NPZ": 0}
        with ZipFile(io.BytesIO(archive.read("inputs/wave_parent.zip"))) as wave:
            for (eq, arm), group in grouped.items():
                for row in group:
                    component = f"seed_{row['seed']}_{arm}"
                    if eq == "wave2d":
                        saved = wave.read(f"postprocess/trials/{component}/selected.weights.h5")
                        require(saved.startswith(bytes.fromhex("894844460d0a1a0a")), "Wrong HDF5 signature")
                        weights["HDF5"] += 1
                    else:
                        saved = archive.read(f"candidates/{eq}/{component}/selected_weights.npz")
                        with ZipFile(io.BytesIO(saved)) as arrays:
                            require(bool(arrays.namelist()) and all(n.endswith(".npy") for n in arrays.namelist())
                                    and arrays.testzip() is None, "Malformed weight array")
                        weights["NPZ"] += 1
        return {"archive_sha256": checksum, "archive_members": len(names), "experiments": len(rows),
                "manifest_files_checked": len(manifest),
                "seeds_by_equation": {p: sorted(s) for p, s in SEEDS.items()}, "methods": sorted(METHODS),
                "aggregated_rows_checked": len(pairs), "weights": weights,
                "embedded_source_files_checked": len(source),
                "validation_records": {key: {"passed": val.get("passed"), "scope": val["source_scope"],
                                             "status_digest_matches": record_digests[key]}
                                       for key, val in validation["checks"].items()},
                "submitted_colab_run": read("validation/current.json")["latest_run"],
                "forward_trials_with_coefficient_error": sum(r["lambda_error"] is not None for r in rows
                    if r["equation"] not in {"wave2d", "kovasznay_inverse"})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = json.dumps(audit(args.zip), indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    print(result, end="")


if __name__ == "__main__":
    main()
