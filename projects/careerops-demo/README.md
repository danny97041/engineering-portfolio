# CareerOps Demo

A recruitment tracker built around job postings, application records, and interview schedules. This portfolio repository runs with synthetic data. The first checkpoint implements a local HTTP API and persistent SQLite storage.

| Capability | Phase 1 |
|---|---|
| Companies, job postings, and schedules | Create, read, edit, and soft-delete |
| Date-only and multi-day events | Preserve unknown times and both dates |
| Access control | Instance-bound bearer credentials, separate read and write privileges |
| Concurrent edits | Record versions and HTTP 409 on stale writes |
| Audit history | Business updates and audit snapshots commit together |
| Deployment | Local loopback API |

## Run the demo

Requires Node.js 24.22.3 or later. The demo has no package installation step. Open a PowerShell terminal at the repository root.

```powershell
$env:CAREEROPS_TOKEN = node scripts/key.mjs demo development
node scripts/local.mjs seed
node scripts/local.mjs serve
```

The server prints its loopback URL. The seed creates three fictional companies, three job postings, and five schedules. It is safe to run again.

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
node --test tests/foundation.test.mjs
```

The tests exercise two isolated local HTTP instances, restart persistence, migration integrity, concurrent writes, and rollback. Test data lives in temporary databases. Release checkpoints are recorded as Git tags.
