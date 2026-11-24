ALTER TABLE job_postings ADD COLUMN posting_number TEXT;
ALTER TABLE job_postings ADD COLUMN open_date TEXT;
ALTER TABLE job_postings ADD COLUMN content_hash TEXT;
CREATE INDEX postings_by_number ON job_postings(company_id,posting_number) WHERE deleted_at IS NULL;
CREATE INDEX postings_by_content ON job_postings(company_id,content_hash) WHERE deleted_at IS NULL;
ALTER TABLE assessments ADD COLUMN input_hash TEXT;
ALTER TABLE assessments ADD COLUMN origin TEXT NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX assessments_by_input ON assessments(posting_id,input_hash) WHERE input_hash IS NOT NULL;
ALTER TABLE change_logs ADD COLUMN correlation_id TEXT;
CREATE TABLE analysis_facts (
  posting_id TEXT PRIMARY KEY REFERENCES job_postings(id),
  details TEXT NOT NULL CHECK(json_valid(details)),
  version INTEGER NOT NULL CHECK(version>0),
  posting_version INTEGER NOT NULL CHECK(posting_version>0)
);
CREATE TABLE analysis_cache (
  posting_id TEXT PRIMARY KEY REFERENCES job_postings(id),
  input_hash TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
ALTER TABLE sync_batches ADD COLUMN result_json TEXT;
CREATE TABLE intake_reviews (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES sync_batches(id),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  created_at TEXT NOT NULL
);
