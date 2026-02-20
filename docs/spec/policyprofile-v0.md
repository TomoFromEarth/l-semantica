# PolicyProfile v0

PolicyProfile v0 is the first machine-readable policy contract for runtime gating in M0.

## Contract Goals
- Enforce explicit contract versioning via `schema_version`.
- Define capability allow/deny controls through `capability_policy.allow` and `capability_policy.deny`.
- Encode escalation requirements through `capability_policy.escalation_requirements`.

## Validation Invariants
- `schema_version` is mandatory and fixed to `0.1.0`.
- At least one capability list must be non-empty (`allow` or `deny`).
- `metadata.environment` is required and constrained to `development`, `staging`, or `production`.
- `production` profiles must default to `manual_approval` escalation.
- `manual_approval` default requires at least one explicit escalation rule.
- Each escalation rule requires `capability`, `escalation_level`, `min_approvals`, and `reason_required`.

## Runtime Validation Contract
- Runtime contract loaders must validate PolicyProfile JSON against `policyprofile-v0.schema.json` before execution.
- Validation failures are hard-stop errors and must block autonomous continuation.
- Validation output should include actionable field-level data (`instancePath`, `keyword`, `message`) for diagnostics.
- Version incompatibility must be reported explicitly at the loader boundary.

## Files
- Schema: `docs/spec/schemas/policyprofile-v0.schema.json`
- Valid examples:
  - `docs/spec/examples/policyprofile/valid/development-default.json`
  - `docs/spec/examples/policyprofile/valid/production-restricted.json`
- Invalid examples:
  - `docs/spec/examples/policyprofile/invalid/missing-schema-version.json`
  - `docs/spec/examples/policyprofile/invalid/production-default-without-manual-approval.json`
  - `docs/spec/examples/policyprofile/invalid/manual-approval-without-rules.json`
  - `docs/spec/examples/policyprofile/invalid/escalation-rule-missing-min-approvals.json`
