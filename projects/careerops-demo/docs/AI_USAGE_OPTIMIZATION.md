# AI usage and measured work

The application uses deterministic code for identity resolution, eligibility rules, schedule exports and audit checks. Stored assessments carry input versions. Cache reuse avoids repeated full rule computation for unchanged inputs, while the evaluator still reads relevant context to establish freshness. A connected model can perform explicit evidence review and call tools.

Analytics counts local rule evaluations, cache hits and intake outcomes. The performance report shows measured latency for cold and cached calls and serialized REST/MCP sizes. No controlled token, pricing or model-quality baseline was collected. [Benchmark](BENCHMARK_REPORT.md)
