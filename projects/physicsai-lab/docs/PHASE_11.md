# Phase 11 · Independent research site

The catalog drives 18 research views. Each saved run carries its checkpoint member, original hash, converted hash, evaluation set and version. Wave spacetime Fourier models evaluate shared spatial and temporal trunks and their pairwise products. The browser checks the selected artifact digest before inference.

All 65 models passed the predeclared 36-point oracle in Chrome. The public results include the per-run metrics and grouped comparisons. The hosted results-only build contains fixed field samples at 17 × 17 resolution, analytic references and research metrics. A separately selected, digest-matched local model enables real single, batch and grid inference on the device. Training analysis identifies validation-group curves separately from the Wave training objective.

The owner-only Import Center accepts a bounded two-file ZIP or split manifest and artifact, verifies the digest, previews the immutable run ID and registers results in a separate R2 namespace with conditional writes. The hosted distribution accepts finite numeric metric objects. New model conversion, publication pointers and rollback belong to Phase 15. Local fixtures verify duplicate handling, conflicts, independent authorization, catalog refresh and read-only tool results.

## Reproduce

Use the pinned source, archive and numerical environment from Phase 9. Pass the verified private output directory to the following commands. Use esbuild 0.25.12 for the Worker bundle.

```text
python scripts/export_browser.py V3_SOURCE V3_ZIP PRIVATE_DATA
node scripts/parity.mjs PRIVATE_DATA
node scripts/field_results.mjs PRIVATE_DATA
python scripts/results.py PRIVATE_DATA/catalog.json results
node scripts/build.mjs PRIVATE_DATA PRIVATE_BUILD/worker.mjs ESBUILD results-only
```

The optional local-models build includes converted weights for device testing. Keep that build and the private input directory outside public Git. The owner-private Sites source uses the results-only build.

