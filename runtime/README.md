# Runtime

Execution engine, policy enforcement, and replay support.

## Contract Specs
- `docs/spec/semanticir-v0.md`
- `docs/spec/policyprofile-v0.md`

## Contract Loader
- `loadRuntimeContracts(input)` validates `semanticIr` and `policyProfile` payloads against v0 schemas.
- Loader errors use `ContractValidationError` with:
  - `code`: `INVALID_INPUT`, `SCHEMA_VALIDATION_FAILED`, or `VERSION_INCOMPATIBLE`
  - `contract`: `RuntimeContracts`, `SemanticIR`, or `PolicyProfile`
  - `issues`: field-level validation details (`instancePath`, `keyword`, `message`)
