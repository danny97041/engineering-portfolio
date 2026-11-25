# CareerOps benchmark · 2026-11-25

Windows x64, Intel(R) Core(TM) i7-10700F CPU @ 2.90GHz, Node v24.22.3, local SQLite, loopback HTTP. Each size starts with a fresh database and 20 postings per synthetic company. Each operation runs two warm-ups and twelve measured repetitions. Times are wall-clock milliseconds. Nearest-rank p95 is the maximum for this small sample. Cold evaluations use distinct postings, cached evaluations use a repeated posting. The batch includes five schedule writes and audit records.

| Postings | Operation | Mean ms | Median ms | p95 ms | Response bytes |
|---:|---|---:|---:|---:|---:|
| 100 | REST search / role filter | 6.08 | 5.69 | 8.09 | 4251 |
| 100 | MCP search / role filter | 5.48 | 5.21 | 7.57 | 9177 |
| 100 | Duplicate preview | 7.09 | 6.84 | 8.52 | — |
| 100 | Rule evaluation (cold) | 3.85 | 3.78 | 4.71 | — |
| 100 | Rule evaluation (cached) | 3.25 | 3.24 | 3.40 | — |
| 100 | Schedule creation | 3.72 | 3.61 | 4.42 | — |
| 100 | Compare two jobs | 3.53 | 3.29 | 6.26 | — |
| 100 | Batch import (5 schedules) | 5.43 | 5.43 | 6.13 | — |
| 1000 | REST search / role filter | 5.12 | 4.97 | 6.34 | 4278 |
| 1000 | MCP search / role filter | 5.35 | 5.20 | 6.25 | 9231 |
| 1000 | Duplicate preview | 7.24 | 6.93 | 10.49 | — |
| 1000 | Rule evaluation (cold) | 3.57 | 3.54 | 4.01 | — |
| 1000 | Rule evaluation (cached) | 3.40 | 3.25 | 3.88 | — |
| 1000 | Schedule creation | 3.16 | 3.13 | 3.46 | — |
| 1000 | Compare two jobs | 3.17 | 3.04 | 3.74 | — |
| 1000 | Batch import (5 schedules) | 4.97 | 4.76 | 7.42 | — |
| 10000 | REST search / role filter | 5.27 | 4.87 | 7.45 | 4306 |
| 10000 | MCP search / role filter | 5.64 | 5.17 | 9.40 | 9287 |
| 10000 | Duplicate preview | 8.27 | 7.97 | 9.36 | — |
| 10000 | Rule evaluation (cold) | 3.67 | 3.64 | 4.09 | — |
| 10000 | Rule evaluation (cached) | 3.42 | 3.28 | 4.35 | — |
| 10000 | Schedule creation | 3.27 | 3.24 | 3.64 | — |
| 10000 | Compare two jobs | 3.18 | 3.08 | 3.87 | — |
| 10000 | Batch import (5 schedules) | 5.04 | 4.81 | 8.00 | — |

### Search before and after

The first implementation loaded every posting before filtering and slicing. The revised implementation scans 128 IDs and search fields at a time, stops once it knows the next cursor, and retrieves full rows for the requested page. Rare queries and deep offsets can still scan the entire catalog. The Unicode case-folding and sort order are preserved.

| Rows | Operation | Before median ms | After median ms |
|---:|---|---:|---:|
| 100 | REST search / role filter | 5.47 | 5.69 |
| 100 | MCP search / role filter | 5.30 | 5.21 |
| 1000 | REST search / role filter | 7.05 | 4.97 |
| 1000 | MCP search / role filter | 7.12 | 5.20 |
| 10000 | REST search / role filter | 29.96 | 4.87 |
| 10000 | MCP search / role filter | 27.43 | 5.17 |

Reproduce with `node scripts/benchmark.mjs measurements.json`. The sample measures local application operations and authenticated REST/MCP transport. Hosted multi-user latency and AI cost savings require separate measurements.
