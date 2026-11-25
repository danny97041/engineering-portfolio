# Phase 13 · PhysicsAI MCP

The Site exposes 12 read-only tools through its private plugin. They cover PDE domains, paged experiments, comparisons, metrics, model metadata, downsampled saved grids, BM25 evidence, browser parity, source-linked summaries, release counts, experiment lineage and model versions. Model calls use the verified Site owner identity. Discovery returns protocol and schema metadata. The MCP module emits tool name and outcome to Worker logs, excluding arguments and identity. It caps each encoded result at 48 KiB.

Saved grids include the original grid size, retained sample indices and frame time. Coordinate inference uses the Lab's browser-local model flow. The hosted MCP publishes a results catalog and has zero model weights. Owner-approved result rows enter list and search results through the same registry revision. Pending model conversions and staged data have no callable prediction route.

The bundled Worker integration tests verify the 12 tools, provenance, a newly registered results row, invalid arguments, anonymous and non-owner denial, cross-origin denial and the absence of hosted prediction and mutation tools.

[Model Context Protocol tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

