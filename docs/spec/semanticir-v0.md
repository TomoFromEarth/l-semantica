# SemanticIR v0

SemanticIR v0 is the first machine-readable contract draft for runtime-facing semantic payloads in M0.

## Contract Goals
- Enforce an explicit contract version field (`schema_version`).
- Require baseline metadata needed for traceability (`metadata.ir_id`, `metadata.created_at`, `metadata.source`).
- Separate deterministic nodes from stochastic nodes at schema level.

## Files
- Schema: `docs/spec/schemas/semanticir-v0.schema.json`
- Canonical valid example: `docs/spec/examples/semanticir/valid/canonical-v0.json`
- Invalid examples:
  - `docs/spec/examples/semanticir/invalid/missing-schema-version.json`
  - `docs/spec/examples/semanticir/invalid/missing-metadata.json`
  - `docs/spec/examples/semanticir/invalid/stochastic-node-in-deterministic-list.json`
