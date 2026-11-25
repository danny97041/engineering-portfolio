# Security verification for the operational review update

| Check | Environment and identity | Result |
|---|---|---|
| Existing Site sharing | Actual Personal and Demo connector, verified owner | Each reports custom policy with one allowed account, zero allowed groups and zero external users. |
| Approved authority and data scope | Local HTTP owner and viewer, isolated assembled Worker with simulated platform identities | Protected reads and writes require authorization. The other principal cannot retrieve or change the exact owner's fixture. Missing identity returns 401 on data, backup and fit routes. |
| Least privilege | Isolated Worker and service scope regression | Separate opaque secrets and explicit owner binding are required. The read credential cannot import. The write credential cannot change application status or download a backup. Demo rejects Personal scan keys. Existing production connector permissions are unchanged pending any dedicated credential migration. |
| SQL and web data | Code review, local suite and isolated Worker | Prepared statements bind data values. Dynamic identifiers come from fixed schema or verified SQLite metadata. A company and job containing ordinary apostrophes round-trip and filter as text. DOM views render external fields as text; source URLs require HTTP(S) without embedded credentials. |
| CSRF, validation and caches | Isolated Worker with simulated identity | Cross-site mutation rejected. Data and backup responses are private and no-store. Body and batch limits are exercised in the HTTP suite. Session cookie flags and sign-out caching are managed by the platform and require live browser evidence. |
| Backward schema and recovery | Assembled Worker, legacy release bundle, isolated D1-compatible SQLite | Read and write an older snapshot after applying immutable migrations in memory. Preserve records, fetch a full snapshot, and restore a prior revision without modifying the live deployment. |
| Idempotency and conflicts | Local SQLite regression | Duplicate receipts produce no duplicate write. Stale assessment and merge versions are rejected. SQL changes and audit history share transaction boundaries. |
| Public leakage | Publication allowlist and staged-file scan | Includes code and synthetic verification only. Keep candidate bundles, private receipts, live identifiers and customer records outside the public repository. |

## Production release checks

Before applying the release to operational data, keep a current owner-only snapshot and confirm the deployment target and access policy. Verify a signed-out browser and an independently authenticated, unapproved account on UI and authorized server paths. Check site settings, browser cache, platform session controls and operational revision through approved evidence. Use a separate synthetic deployment for recovery and invalid-input regression. Real scheduled write verification uses the next legitimate eligible scan result and a replay only when the same operation needs retry. Keep the storage and origin evidence separate from readiness of independent development.

For future model and ZIP uploads, require a size-bounded staging area, verified manifests and normalized relative member paths with an expansion budget. Allow explicit safe tensor and metadata formats, reject executable and pickle-based inputs, and validate shapes, finite outputs and expected numerical references in isolation. The current CareerOps source accepts links as evidence and does not fetch those links server-side. Any future fetcher needs its own protocol, destination and redirect controls.

At final release, repeat identity, data scope, backups, cache and dependency checks on the shipped commit. Record dates, environments and pass or pending states. Private operational backups and provider-held tool-audit retention have distinct scopes.
