CREATE TABLE fit_profiles (
  posting_id TEXT NOT NULL REFERENCES job_postings(id),
  version INTEGER NOT NULL CHECK(version>0),
  posting_version INTEGER NOT NULL CHECK(posting_version>0),
  receipt_key TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  details TEXT NOT NULL CHECK(json_valid(details)),
  PRIMARY KEY(posting_id,version)
);
CREATE TABLE intake_resolutions (
  review_id TEXT PRIMARY KEY REFERENCES intake_reviews(id),
  receipt_key TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('approved','merged','dismissed')),
  posting_id TEXT REFERENCES job_postings(id),
  reason TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
ALTER TABLE scan_runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'unverified'
  CHECK(origin IN ('unverified','manual','scheduled'));
CREATE TABLE intake_scan_links (
  review_id TEXT PRIMARY KEY REFERENCES intake_reviews(id),
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id)
);
