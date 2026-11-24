# CareerOps Demo

A browser-based recruitment tracker built around job postings, application records, and interview schedules. The demo uses synthetic data and persists edits in a local SQLite database.

| Capability | Phase 3 |
|---|---|
| Companies, job postings, and schedules | Create, read, edit, and soft-delete |
| Date-only and multi-day events | Preserve unknown times and both dates |
| Access control | Instance-bound bearer credentials, separate read and write privileges |
| Concurrent edits | Record versions and HTTP 409 on stale writes |
| Audit history | Business updates and audit snapshots commit together |
| Workspace | Application stages, schedule and calendar, two to five posting comparison, Korean and English UI |
| Schedule exports | CSV, Markdown, and ICS with date-only and period handling |
| Eligibility and fit | Evidence-based rules, versioned scores, and criterion-level comparisons |
| Posting intake | Idempotent registration, source merge, and duplicate review queue |
| Analytics | SQLite aggregates and measured local processing |
| Deployment | Local loopback browser app and API |

## Run the demo

Requires Node.js 24.22.3 or later. The demo has no package installation step. Open a PowerShell terminal at the repository root.

```powershell
$env:CAREEROPS_TOKEN = node scripts/key.mjs demo development
$env:CAREEROPS_TOKEN
node scripts/local.mjs seed
node scripts/seed-analysis.mjs
node scripts/local.mjs serve
```

Open the loopback URL printed by the server and paste the demo access key from this terminal. The seed creates three fictional companies, three job postings, and five schedules. It is safe to run again.

In Job Explorer, select two postings and open Compare. In Schedule, add an event with its start date empty and find it under Undated after saving. Applications records intent and actual progress separately. Confirm an actual submission before moving an application to Submitted.

Open Assessments to see two synthetic candidates with complete fit scores and a third with missing evidence. The comparison view shows per-criterion bars for the available scores. Analytics reports database-backed counts and local processing metrics. [Eligibility, fit, and intake contract](docs/ANALYSIS.md)

### Read a schedule

Stop the foreground server with Ctrl+C if you used the previous block. Run this example in the same shell to start a temporary demo server and query it.

```powershell
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/local.mjs','serve' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
try {
  $headers = @{ Authorization = "Bearer $env:CAREEROPS_TOKEN" }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $rows = Invoke-RestMethod 'http://127.0.0.1:4312/api/v1/schedules' -Headers $headers
      break
    } catch {
      if ($attempt -eq 19) { throw }
      Start-Sleep -Milliseconds 150
    }
  }
  $rows | Select-Object title,start_date,end_date,start_time,end_time
} finally {
  if (!$server.HasExited) { Stop-Process -Id $server.Id }
}
```

## Architecture

HTTP → input and identity checks → application service → SQLite transaction. Domain validation and catalog SQL are shared by the local implementation. The D1 adapter provides a read contract covered by a local test double. Hosted storage and deployment are later milestones.

[Entity relationships and data dictionary](docs/DATA_CONTRACT.md)

## Verification

```powershell
node --test
```

The 28 automated tests exercise eligibility boundaries, evidence and score versions, intake idempotency, authorization, schema upgrades, workflow transitions, and calendar export. A browser smoke test confirmed rule outcomes, partial-score coverage, comparison bars, and analytics.
