CREATE TABLE career_records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('interview','document','study')),
  posting_id TEXT REFERENCES job_postings(id), details TEXT NOT NULL CHECK(json_valid(details)),
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX career_records_posting ON career_records(posting_id,kind);
CREATE TABLE exchange_receipts (
  key TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result))
);
