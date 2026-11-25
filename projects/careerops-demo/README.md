# CareerOps Demo

A browser-based recruitment tracker built around job postings, application records, and interview schedules. The demo uses synthetic data and persists edits in a local SQLite database.

| Capability | CareerOps v4.1 |
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
| Integrations | Authenticated REST and MCP, role-scoped tool discovery, interactive schedule resource |
| Scan recovery | Atomic batches, source evidence, conflict review, durable retries and run history |
| Career records | Interviews, shared study references and document metadata |
| Recovery | Versioned import, full and incremental SQLite backups with integrity checks |
| Synthetic sandbox | Independent dataset and key per launch, MCP playground and reset |
| Deployment | Local loopback browser app and API |

## Run the demo

Run `node scripts/demo.mjs` from this project directory. Open the printed URL and enter the session key. The isolated portfolio sandbox starts with 72 synthetic postings and has an MCP Playground with a reset button. [Demo walkthrough](docs/PORTFOLIO.md) · [Import and recovery](docs/EXCHANGE.md)

### Persistent starter workspace

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

The 48 automated tests cover eligibility, evidence, permissions, REST/MCP writes, Work exchange, backup restoration, sandbox isolation, pending results and private GPT link validation. The browser check covers agenda highlights and agenda behavior when the analysis endpoint returns an error.

[CareerOps v4.1 release notes](docs/V4.1_RELEASE.md) · [CareerOps v4 release notes](docs/V4_RELEASE.md)

[Gateway contract and synthetic import example](docs/GATEWAY.md)

[Release tests](docs/TEST_REPORT.md) · [Benchmark](docs/BENCHMARK_REPORT.md) · [Architecture case study](docs/PORTFOLIO_CASE_STUDY.md) · [MCP tools](docs/MCP_TOOLS.md)
[Work migration contract](docs/DATA_IMPORT_GUIDE.md)
