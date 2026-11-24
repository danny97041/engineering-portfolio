ALTER TABLE job_postings ADD COLUMN updated_at TEXT;
ALTER TABLE schedules RENAME TO schedules_v1;
CREATE TABLE schedules (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, start_date TEXT, end_date TEXT,
  start_time TEXT, end_time TEXT, location TEXT, status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','conditional','completed','cancelled')),
  condition_note TEXT, source_url TEXT, verified_on TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
  predecessor_id TEXT REFERENCES schedules(id), arrival_time TEXT, admission_deadline TEXT,
  preparation TEXT, notes TEXT, certainty TEXT NOT NULL DEFAULT 'planned'
    CHECK (certainty IN ('confirmed','planned','unverified')),
  CHECK(start_date IS NOT NULL OR coalesce(end_date,start_time,end_time,arrival_time,admission_deadline) IS NULL),
  CHECK(end_date IS NULL OR end_date>=start_date),
  CHECK(end_time IS NULL OR start_time IS NULL OR coalesce(end_date,start_date)>start_date OR end_time>=start_time)
);
INSERT INTO schedules (id,posting_id,kind,title,start_date,end_date,start_time,end_time,location,status,
  condition_note,source_url,verified_on,version,deleted_at)
SELECT id,posting_id,kind,title,start_date,end_date,start_time,end_time,location,status,
  condition_note,source_url,verified_on,version,deleted_at FROM schedules_v1;
DROP TABLE schedules_v1;
CREATE INDEX schedules_by_date ON schedules(start_date,start_time,id) WHERE deleted_at IS NULL;
CREATE INDEX schedules_by_posting ON schedules(posting_id);
ALTER TABLE application_events ADD COLUMN previous_intent TEXT;
ALTER TABLE application_events ADD COLUMN next_intent TEXT;
