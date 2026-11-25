# CareerOps case study

The project addresses a recurring decision problem in recruiting workflows. A new opening at a previously considered company can be a distinct round, while an edited posting can describe the same opportunity. CareerOps keeps round identity, application intent, actual submission and evidence timestamps separate. A versioned update changes a calendar entry and its audit record atomically.

The owner supplied the workflow, privacy constraints and acceptance scenarios. Codex implemented the prototype and verification code. The portfolio uses synthetic examples and an isolated demo. The local benchmark measures API and MCP request cost at three dataset sizes. Hosted synchronization prioritizes parity with the local rules engine and transactional checks at the cost of loading and saving a compressed SQLite image per request.

[Interactive walkthrough](PORTFOLIO.md) · [Measured performance](BENCHMARK_REPORT.md)
