# CareerOps API and MCP

Start the synthetic demo using the repository README. Send its generated local bearer token in the Authorization header. The authenticated GET /api/contract publishes the route-to-tool mapping, argument schemas, output envelope and tool annotations for the caller. The existing browser uses /api/v1. External integrations use /api and the stateless JSON-RPC endpoint POST /mcp. Supported discovery includes server/discover, initialize, tools/list and tools/call.

| REST route | Methods | Data |
|---|---|---|
| /api/jobs and /api/jobs/{id} | GET, POST collection · GET, PATCH record | Catalog search, exact read, create and update |
| /api/applications and /api/applications/{id} | GET, POST collection · PATCH record | Application decisions and confirmed submissions |
| /api/schedules and /api/schedules/{id} | GET, POST collection · PATCH record | Calendar entries and versioned edits |
| /api/assessments | GET, POST | List assessment metadata or save {id,data:{versions,components}} |
| /api/rules/evaluate and /api/duplicates/check | POST | Evaluate stored evidence or preview posting identity |
| /api/analytics, /api/changes, /api/export | GET | Aggregate statistics, change metadata, handover summary |
| /api/automations/runs and /api/automations/runs/{id} | GET, POST | Receive batches, inspect evidence, retry a failed run |
| /api/import | POST | Deliver one discovery batch |

REST create and edit bodies contain the resource fields. Supply Idempotency-Key for writes and a quoted If-Match version for PATCH. The MCP equivalents take key, data and, for edits, id and version. Both transports share receipts. A reused key with changed input returns 409. Authentication is required for both, and the reader can search or read individual job postings. Supply limit (1–30) and offset to page list tools. Changes use the after sequence instead. The default page is 15 items. Application requests are limited to 16 KiB and tool result data to 32 KiB. Use narrower pages for large evidence. JSON-RPC tool failures include isError, a status and a message. An HTTP 200 alone does not establish tool success.

### Discovery batch

POST /api/import accepts the following body. To reproduce it on a fresh database, first create a synthetic company named Observatory Demo. An unresolved name goes into the review queue.

```json
{"key":"sample-scan-001","items":[{"company":"Observatory Demo","source":"https://example.invalid/jobs/thermal","observedAt":"2024-01-01T00:00:00.000Z","evidence":"Synthetic listing for a thermal simulation role.","posting":{"round_key":"trial-1","role_code":"thermal","title":"Thermal simulation engineer"}}]}
```

A scan accepts up to ten items. Preview with validate_import. Use expectedVersion for a change to an existing posting. Source timestamps, the last applicable observation and intervening manual edits govern conflicts. Inspect proposed and previous fields with GET /api/automations/runs/{id}. A scheduleProposal is recorded with its source for owner review. Applying an official calendar change requires a versioned schedule edit. The application decision and stage belong to the owner. A failed scan receipt includes status, attempts and retryable. POST an empty object and a new Idempotency-Key to the exact failed run URL to retry its stored input. Three attempts exhaust that run. Corrected source data needs a new run key.

### MCP Apps

get_schedule advertises a global navigation entrypoint. get_schedule, get_job_details and compare_jobs share a UI resource for schedule edits, posting details and comparison cards. The view renders supplied text as text nodes and requests edits through the host with the observed version. The JSON-RPC result also carries the data for text clients. Host presentation and installation are tested separately from the resource contract. [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx) · [OpenAI Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)

### Storage and deployment

The full local adapter uses Node HTTP and SQLite. integrations/sites/sandbox contains the independent Worker and database migration used to test Site-scoped synthetic records. Each record and request key belongs to a Site principal. The hosted sandbox implements get_test_record, add_test_record and update_test_record. The workspace gateway and its 34 tools run locally. A full hosted workspace adapter and its production data binding require a separate deployment.
