# API reference

Authenticated GET /api/contract lists the REST gateway routes, matching MCP tools and schema versions. See [gateway contracts](GATEWAY.md) for pagination, payload limits, optimistic edits, ids and retry semantics.

| Additional route | Contract |
|---|---|
| GET, POST /api/records | List records or create interview, study and document metadata |
| GET, PATCH, DELETE /api/records/{id} | Read by exact ID, edit or soft-delete with quoted If-Match |
| POST /api/commands | Return a query result or a versioned preview to confirm |
| POST /api/exchange/preview and /api/exchange/import | Validate and apply version 1 Work batches |
| GET /api/exchange/export | mode full, handover or changes, optional sequence cursor after |
| GET /api/sandbox, POST /api/sandbox | Inspect sandbox capability and reset an enabled demo |
| GET /api/health | Hosted realm, stage and D1 availability |
| GET /api/recovery and /api/recovery/download | Hosted per-user history or current SQLite download |
| POST /api/recovery | Restore a verified prior revision with an expected current revision |

The local HTTP adapter requires an instance bearer token. The private hosted adapter uses the Site session and its own server-side identity binding.
