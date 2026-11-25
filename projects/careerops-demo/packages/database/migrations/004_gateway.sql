CREATE TABLE tool_receipts (
  actor TEXT NOT NULL, name TEXT NOT NULL, request_key TEXT NOT NULL, digest TEXT NOT NULL,
  result TEXT NOT NULL CHECK(json_valid(result)), PRIMARY KEY(actor,name,request_key)
);
CREATE TABLE tool_calls (
  seq INTEGER PRIMARY KEY, call_id TEXT NOT NULL, actor TEXT NOT NULL, tool TEXT NOT NULL,
  status INTEGER NOT NULL, occurred_at TEXT NOT NULL, result_bytes INTEGER NOT NULL
);
ALTER TABLE scan_runs ADD COLUMN digest TEXT;
ALTER TABLE scan_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scan_runs ADD COLUMN last_error TEXT;
ALTER TABLE scan_runs ADD COLUMN request_json TEXT;
CREATE TABLE scan_attempts (
  run_id TEXT NOT NULL REFERENCES scan_runs(id), attempt INTEGER NOT NULL, ended_at TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, PRIMARY KEY(run_id,attempt)
);
CREATE TABLE scan_watermarks (posting_id TEXT PRIMARY KEY REFERENCES job_postings(id), observed_at TEXT NOT NULL);
CREATE INDEX scan_result_run ON scan_results(run_id);
