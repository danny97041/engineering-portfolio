# Eligibility, fit, and intake

Phase 3 consumes structured evidence from a job description. Rules return PASS, FAIL, or UNKNOWN with a reason and a rule version. Evidence supports company size and direct role responsibility. A hard qualification failure remains visible alongside any fit score. Company and posting exclusions affect recommendations, active schedules, and exports.

Complete weighted fit scores require evidence for all criteria with positive weight. Partial assessments retain component scores and coverage. Posting, source facts, profile, and weight versions invalidate old assessments. A posting edit also suspends its previous rule evidence until reconfirmed.

## Owner API

Paths are relative to `/api/v1/`.

| Request | Input or output |
|---|---|
| GET analysis | Posting summaries, weights, DB statistics and local metrics |
| GET analysis/{id} | Rule outcomes, source evidence, revisions, latest assessment |
| PUT analysis_facts/{id} | `{version, postingVersion, facts}` using values from the review |
| POST assessments/{id} | `{versions, components}` with manual evidence-backed scores |
| PUT analysis_weights | `{version, weights}` for all six categories with a total of 100 |
| PUT exclusions | `{scope, id, reason, active}` with scope company or posting |
| POST intake | `{key, company, posting, content?}` with an existing company name or alias |
| GET intake | Rows awaiting manual duplicate or company review |

Example `facts` object for a fictional posting:

```json
{
  "company": {"listed": false, "employees": 55, "evidence": "Synthetic workforce note"},
  "role": {"track": "physics_ai", "direct": true, "evidence": "Synthetic description"},
  "coding": {"type": "unknown", "evidence": "Synthetic test notice"},
  "qualifications": {
    "language": {"mode": "required", "value": "OPIc IH", "evidence": "Synthetic eligibility paragraph"}
  }
}
```

Recognized tracks are `industrial_cfd`, `physics_ai`, `manufacturing_simulation`, and `other`. Qualification modes are `required`, `preferred`, `none`, and `unknown`. Structured language comparisons currently use OPIc levels. Use a canonical degree code such as `master` in the profile. Unspecified groups and unsupported comparisons receive UNKNOWN.

Under `components`, each key identifies a criterion. A component can look like `{"score": 80, "evidence": "Synthetic Python exercise", "uncertainty": "Production experience unverified"}`. Consult the review weights for the six keys.

## Intake and measurements

Company, canonical round, and role code establish merge identity. Normalized URLs, posting number, title, dates and content hash surface potential matches for manual review. Reusing a key with the same authenticated request returns its original outcome. Uncertain matches stay in the review queue.

Analytics uses stored postings, assessments, applications, scans and intake outcomes. It reports denominators for offers, durations, and scored records. Local telemetry includes rule calculations, assessment calculations, cache reuse, duplicate merges, retries, intake bytes and rule review latency. Hosted and AI usage metrics depend on those integrations.
