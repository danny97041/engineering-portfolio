# Database schema

Local and hosted application snapshots use the numbered packages/database/migrations SQL files. Migration checksums bind a database to its schema history. [Entity dictionary](DATA_CONTRACT.md)

| Migration | Data |
|---|---|
| 001 | Binding, principals and profiles, companies, postings, applications, schedules, rules, runs and audit |
| 002 | Versioned workflow, schedule dependencies and explicit submission state |
| 003 | Evidence facts, analysis cache, intake reviews and versioned assessments |
| 004 | Tool calls, idempotency receipts, scan attempts and source watermarks |
| 005 | Posting-linked career records and exchange receipts |

Each hosted D1 additionally holds workspace_revisions scoped by principal and revision. A unique parent prevents a concurrent write from replacing another decision. The Demo retains its earlier synthetic QA records separately. [Backup and recovery](EXCHANGE.md)
