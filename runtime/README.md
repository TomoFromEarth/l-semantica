# Runtime

Execution engine, policy enforcement, and replay support.

## Contract Specs
- `docs/spec/semanticir-v0.md`
- `docs/spec/policyprofile-v0.md`
- `docs/spec/trace-ledger-v0.md`

## Contract Loader
- `loadRuntimeContracts(input)` validates `semanticIr` and `policyProfile` payloads against v0 schemas.
- Validation failures use `ContractValidationError` with:
  - `code`: `INVALID_INPUT`, `SCHEMA_VALIDATION_FAILED`, or `VERSION_INCOMPATIBLE`
  - `contract`: `RuntimeContracts`, `SemanticIR`, or `PolicyProfile`
  - `issues`: field-level validation details (`instancePath`, `keyword`, `message`)
- Setup failures (for example unreadable schema files or resolver initialization failures) may throw standard `Error`.

## Trace Ledger
- `runSemanticIr(ir, options)` emits one trace ledger entry per invocation.
- Set `options.traceLedgerPath` to append JSON-lines records to a file.
- Each entry includes:
  - `run_id`
  - `started_at` and `completed_at`
  - `contract_versions.semantic_ir` and `contract_versions.policy_profile`
  - `outcome.status` (`success` or `failure`) and `outcome.error` for failure cases
