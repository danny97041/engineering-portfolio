CREATE TABLE instance_binding (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  realm TEXT NOT NULL CHECK (realm IN ('personal','demo')),
  stage TEXT NOT NULL CHECK (stage IN ('development','operational'))
);
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','viewer'))
);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), details TEXT NOT NULL CHECK(json_valid(details) AND json_type(details)='object'),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE skills (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
CREATE TABLE user_skills (
  user_id TEXT NOT NULL REFERENCES users(id), skill_id TEXT NOT NULL REFERENCES skills(id),
  level TEXT NOT NULL, evidence TEXT, PRIMARY KEY(user_id,skill_id)
);
CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL COLLATE NOCASE, size_class TEXT, institution_type TEXT,
  source_url TEXT, verified_on TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE UNIQUE INDEX companies_active_name ON companies(name) WHERE deleted_at IS NULL;
CREATE TABLE company_aliases (
  alias TEXT PRIMARY KEY NOT NULL COLLATE NOCASE, company_id TEXT NOT NULL REFERENCES companies(id)
);
CREATE TABLE job_postings (
  id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), round_key TEXT NOT NULL,
  role_code TEXT NOT NULL, title TEXT NOT NULL, responsibilities TEXT, location TEXT, headcount INTEGER CHECK(headcount>=0),
  compensation TEXT, employment_type TEXT, deadline_date TEXT, deadline_time TEXT, review_status TEXT NOT NULL DEFAULT 'new',
  posting_status TEXT NOT NULL DEFAULT 'unverified', previous_id TEXT REFERENCES job_postings(id), version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT, UNIQUE(company_id,round_key,role_code), CHECK(deadline_time IS NULL OR deadline_date IS NOT NULL)
);
CREATE TABLE job_requirements (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  kind TEXT NOT NULL CHECK(kind IN ('required','preferred')), criterion TEXT NOT NULL
);
CREATE TABLE job_sources (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  url TEXT NOT NULL, verified_on TEXT, evidence TEXT, UNIQUE(posting_id,url)
);
CREATE TABLE applications (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  user_id TEXT NOT NULL REFERENCES users(id), intent TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'not_submitted',
  submitted_at TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, UNIQUE(user_id,posting_id),
  CHECK(stage!='not_submitted' OR submitted_at IS NULL)
);
CREATE TABLE application_events (
  id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL REFERENCES applications(id),
  previous_stage TEXT, next_stage TEXT NOT NULL, occurred_at TEXT NOT NULL, source TEXT NOT NULL
);
CREATE TABLE assessments (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  evaluation_version TEXT NOT NULL, evidence TEXT NOT NULL, assessed_at TEXT NOT NULL
);
CREATE TABLE assessment_scores (
  assessment_id TEXT NOT NULL REFERENCES assessments(id), criterion TEXT NOT NULL,
  score REAL NOT NULL, rationale TEXT NOT NULL, PRIMARY KEY(assessment_id,criterion)
);
CREATE TABLE schedules (
  id TEXT PRIMARY KEY NOT NULL, posting_id TEXT NOT NULL REFERENCES job_postings(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  start_time TEXT, end_time TEXT, location TEXT, status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','conditional','completed','cancelled')),
  condition_note TEXT, source_url TEXT, verified_on TEXT,
  version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
  CHECK(end_date IS NULL OR end_date>=start_date),
  CHECK(end_time IS NULL OR start_time IS NULL OR coalesce(end_date,start_date)>start_date OR end_time>=start_time)
);
CREATE INDEX schedules_by_date ON schedules(start_date,start_time,id) WHERE deleted_at IS NULL;
CREATE INDEX schedules_by_posting ON schedules(posting_id);
CREATE TABLE rules (
  id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, version INTEGER NOT NULL,
  definition TEXT NOT NULL CHECK(json_valid(definition)), active INTEGER NOT NULL CHECK(active IN (0,1)), UNIQUE(code,version)
);
CREATE TABLE exclusions (
  id TEXT PRIMARY KEY NOT NULL, company_id TEXT REFERENCES companies(id), posting_id TEXT REFERENCES job_postings(id),
  rule_id TEXT REFERENCES rules(id), reason TEXT NOT NULL, CHECK((company_id IS NULL)!=(posting_id IS NULL))
);
CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE
);
CREATE TABLE scan_results (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES scan_runs(id),
  posting_id TEXT REFERENCES job_postings(id), outcome TEXT NOT NULL, evidence TEXT
);
CREATE TABLE interview_preparations (
  id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL REFERENCES applications(id), notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE interview_questions (
  id TEXT PRIMARY KEY NOT NULL, preparation_id TEXT NOT NULL REFERENCES interview_preparations(id), question TEXT NOT NULL, answer TEXT
);
CREATE TABLE interview_feedback (
  id TEXT PRIMARY KEY NOT NULL, question_id TEXT NOT NULL REFERENCES interview_questions(id), feedback TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL, application_id TEXT REFERENCES applications(id), kind TEXT NOT NULL, version INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE sync_batches (
  id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_digest TEXT NOT NULL, status TEXT NOT NULL, conflicts TEXT
);
CREATE TABLE change_logs (
  seq INTEGER PRIMARY KEY, entity TEXT NOT NULL, record_id TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id),
  before_json TEXT CHECK(json_valid(before_json)), after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  changed_at TEXT NOT NULL
);
CREATE INDEX changes_by_entity ON change_logs(entity,record_id,seq);
CREATE TABLE usage_metrics (
  id TEXT PRIMARY KEY NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, measured_at TEXT NOT NULL
);
CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)), version INTEGER NOT NULL DEFAULT 1);
