# CareerOps transfer and recovery

Use Data Exchange to preview and apply a version 1 JSON batch. The transport accepts up to 30 rows and 16 KiB per request. [Envelope schema](exchange-v1.schema.json) · [Synthetic JSON](../fixtures/synthetic/exchange-v1.json) · [CSV mapping example](../fixtures/synthetic/exchange-v1.csv)

Convert each CSV row to a JSON item using the column names and parse the data cell as JSON. Add a batch key and schemaVersion 1. Supported mappings follow the existing validated service fields.

| Item type | Data and identification |
|---|---|
| companies, job_postings, schedules | Resource fields. Existing records use id and version. |
| applications | On creation include posting_id; on edit supply id and version. Use confirm_submission only for a confirmed submission. |
| profile | Qualification fields with current profile version. |
| rules | code, version, definition, active. This stores versioned rule definitions. Built-in eligibility logic remains the execution engine. |
| exclusions | scope, id, reason, active. |
| analysis_facts | Posting id, fact version, and evidence groups. Version 0 creates facts. |
| assessments | Posting id and criterion components. Assessment uses the versions visible when that row is applied. |
| career_records | On create use kind, postingId and data. On edit use row id, version and nested data. |

Place parents before dependants and use a one-field object such as {"$ref":"company"} for a previous row ID. Preview runs the same validations under rollback. A dry-run ID is temporary. Apply returns successful rows, before/after evidence and rejected rows. Corrected records need a new key. A previously applied identical batch returns its recorded outcome.

Full JSON is a private report of application tables. Changes JSON uses the nextAfter cursor. Data Exchange also produces a Markdown handover, CSV, ICS and clipboard output. Export and backup can contain private records. Binary document contents live at their referenced source. The application stores document metadata and HTTPS references.

### Local backup and recovery

Set CAREEROPS_REALM and CAREEROPS_STAGE for the source. Use a private directory with filesystem access restricted to the operator. Use distinct new destinations in that directory.

```powershell
node scripts/recovery.mjs backup ./base.sqlite
node scripts/recovery.mjs backup ./delta.json ./base.sqlite
node scripts/recovery.mjs restore ./recovered.sqlite ./base.sqlite
node scripts/recovery.mjs restore ./recovered-latest.sqlite ./base.sqlite ./delta.json
```

A full snapshot contains settings, records, audit history, import receipts and metadata. The incremental file holds changed blocks against a verified base. Restore checks the binding, foreign keys and SQLite integrity and produces a separate file. To switch the application to a restored store, stop the service, preserve the active database and its journal/sidecars together, install the verified file as that binding's careerops.sqlite, then reopen and verify the workspace. Hosted storage and external document contents require their provider's separate backup procedure.
