# Phase 7 release verification · 2026-11-25

Run `node --test` from the project root. Tests use temporary files and loopback HTTP servers. The Chrome exercise ran on the local synthetic site with a fresh owner key and a separate temporary database.

| Acceptance cases | Evidence |
|---|---|
| T01–T08 | analysis.test.mjs checks evidence-backed company sizes, role classification, qualification boundaries and uncertainty, duplicate intake and new rounds. |
| T09–T12 | workspace.test.mjs and advanced.test.mjs check intent vs submission, exact round confirmation, rejected applications, past vs active schedules and calendar exports. |
| T13 | release.test.mjs exercises an owner-confirmed official change. A stale linked schedule rolls back the entire change. Successful replay preserves both versions and audit events. |
| T14–T18 | foundation, analysis, workspace and gateway suites check source aggregates, persisted edits after restart, keyed imports, denied authorization and bounded MCP errors. |
| T19–T22 | gateway and portfolio suites cover discovery outcomes, exclusion, stale evidence, bounded retries and temporary storage failures. Analysis tests observe saved evaluation reuse. Live repeated alert delivery remains dependent on the external automation. |
| T23–T26 | advanced, portfolio, foundation, analysis and gateway suites verify distinct full/incremental snapshots, integrity, tenant binding, sandbox reset and treatment of external text as data. |
| Work migration | release.test.mjs exercises historical date/unknown-date preservation, terminal state, evidence attribution, batch preview and idempotent replay. |

Chrome actually filtered and sorted job postings, selected two for comparison, added a posting through review and save, confirmed submission for an exact round, opened schedules, interviews and exchange, called MCP and reset the demo. The resulting SQLite posting count returned to 72. The run captured no browser page errors. These browser exercises used local HTTP. The release used a separate service probe for hosted storage and recovery.

Both deployed Sites returned 401 for unsigned UI, static JavaScript, health API and MCP. The private service verification used its own ephemeral principal, committed a synthetic row, reopened it on another request, restored a prior revision and checked the row was absent. The signed-in Codex client read separate dashboard counts. Existing Work automation connector identity and general Chat host rendering require product-side evidence.

The pinned Worker build dependency audit reported zero known registry advisories. The release tests are a point-in-time observation; multi-region load and recovery from provider-wide outages have not been tested.

For the optional browser run, provide playwright-core to the script, set CAREEROPS_CHROME to a local Chromium executable and run node scripts/browser-smoke.mjs. The release run used playwright-core 1.65.1. The application itself does not depend on Playwright. The final core suite passed 46 tests. The hosted verification additionally invoked the Work MCP preview, applied and replayed a historical synthetic application, and reopened its recorded submission date before restoring the initial revision.
