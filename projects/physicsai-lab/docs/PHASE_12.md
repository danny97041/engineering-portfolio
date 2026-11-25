# Phase 12 · Research services

The hosted RAG Explorer and Agent Playground call the same read-only Sites endpoint. The compare, metrics and search tools return catalog evidence. Responses identify the model release, run, evaluation set or source document. BM25 uses k1 = 1.2 and b = 0.75. The Worker reuses unchanged postings by source digest, release and text, updates changed documents, then swaps the finished index. A failed refresh preserves the prior version and marks the response stale. Hosted inference is browser-local with an explicitly selected matching file. Server-side prediction is available in the separate local-models test build.

## Original API

Use the original FastAPI application to obtain its full OpenAPI contract. The local launcher checks the Git revision, module working tree and ZIP digest and calls the upstream service factory with writes disabled. It serves on loopback. Install requirements-audit.txt plus uvicorn 0.38.0 for serving. Optional FAISS vector verification used faiss-cpu 1.13.0.

```text
python scripts/serve_v3.py V3_SOURCE V3_ZIP --port 8127
python scripts/serve_v3.py V3_SOURCE V3_ZIP --check api-verification.json
python scripts/check_vectors.py V3_ZIP vector-verification.json
```

Open http://127.0.0.1:8127/docs for the original API. Its 14 route checks covered saved results, original-model predictions, retrieval, tools, empty active-model state (422) and disabled activation (403). The Sites Worker has a smaller, explicit API and a separate origin. Sites hosts Worker ES modules. The original CPython/TensorFlow environment runs locally or in Colab.

## Search and agent scope

The source artifact contains 3,593 E5 vectors of dimension 384. Its hybrid policy gives E5 0.6 and BM25 0.4 with RRF constant 60. On 32 stored-vector queries, FAISS IndexFlatIP and NumPy agreed on the top-five scores within 1.20 × 10⁻⁷. This measures vector scoring. New text-to-vector encoding was not executed. Hosted BM25 retrieved release-specific Heat experiment cards in the deployed Site. Statistical relevance across natural-language questions remains a separate evaluation.

The original Qwen3.5-0.8B weight file is 1.75 GB. At an assumed 100 Mbit/s, transferring those weights alone takes at least 140 seconds, before tokenization and initialization. Browser generation latency is unmeasured. The hosted interface uses explicitly selected structured tools. The original local service keeps its optional LLM and semantic paths. [Official Qwen file inventory](https://huggingface.co/Qwen/Qwen3.5-0.8B/tree/main)

## Distribution verification

The results-only bundle had 77 enumerated assets and zero weight assets. The hosted owner view displayed nine PDE configurations and 65 runs. A live heat2d search returned source-linked metrics from the deployed BM25 index. Import writes, conflict handling and retry were exercised in an isolated bucket fixture. A production write round trip remains unverified. New-model publication and rollback are scheduled for Phase 15.

