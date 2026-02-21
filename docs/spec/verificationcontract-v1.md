# VerificationContract v1

VerificationContract v1 is the first machine-readable contract draft for verification-gated autonomous continuation in M1.

## Contract Goals
- Enforce explicit versioning through `schema_version`.
- Define required verification checks across tests and static analysis.
- Encode required policy assertions that must hold before continuation.
- Define deterministic pass criteria and continuation behavior on success/failure.

## Contract Shape (v1)
- `schema_version` (required): fixed to `1.0.0`.
- `contract_id` (required): non-empty identifier for the verification policy set.
- `generated_at` (required): timestamp string that matches the schema's RFC3339/ISO-8601-style pattern with bounded date/time/offset components.
- `requirements` (required object):
  - `tests` (required array): required test checks; at least one entry and at least one entry with `required: true`.
  - `static_analysis` (required array): required static checks; at least one entry and at least one entry with `required: true`.
  - `policy_assertions` (required array): policy gates to verify; at least one entry and at least one entry with `required: true`.
- `pass_criteria` (required object):
  - `minimum_required_checks_pass_ratio` (required): number in `[0, 1]`.
  - `require_all_policy_assertions` (required): boolean.
  - `max_warning_count` (required): integer `>= 0`.
- `continuation` (required object):
  - `on_success` (required enum): `continue`.
  - `on_failure` (required enum): `escalate` or `stop`.
  - `require_policy_profile` (required): boolean policy-gate requirement.
  - `required_feedback_tensor_fields` (required array): required FeedbackTensor sections for verification evidence.

## Composition Notes
- `PolicyProfile` composition:
  - Verification policy assertions target PolicyProfile paths (for example escalation defaults and capability controls).
  - If `require_policy_profile` is true, runtime continuation gating must require a valid PolicyProfile contract before autonomous continuation.
- `FeedbackTensor` composition:
  - VerificationContract requires explicit FeedbackTensor fields as evidence inputs for continuation decisions.
  - Missing required FeedbackTensor evidence fields should be treated as incomplete verification and block autonomous continuation.

## Compatibility and Versioning Notes
- VerificationContract v1 uses semantic version `1.0.0` for the first stable major-family draft.
- Consumers using this schema draft must reject any payload where `schema_version` is not exactly `1.0.0`.
- Additive changes should be introduced via a new published schema/doc revision (for example, a future `1.x` file) with explicit compatibility notes.
- Any field removal, required-field addition, enum narrowing, or semantic reinterpretation requires a major version bump and migration notes.

## Runtime Validation Contract
- Runtime-side schema tests must validate all committed valid fixtures and reject all committed invalid fixtures.
- Runtime loaders must reject invalid and incompatible VerificationContract payloads with actionable field-level details (`instancePath`, `keyword`, `message`).
- Verification failure states are hard-stop conditions for autonomous continuation paths.

## Files
- Schema: `docs/spec/schemas/verificationcontract-v1.schema.json`
- Valid examples:
  - `docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json`
  - `docs/spec/examples/verificationcontract/valid/escalate-on-failure-with-thresholds.json`
- Invalid examples:
  - `docs/spec/examples/verificationcontract/invalid/missing-schema-version.json`
  - `docs/spec/examples/verificationcontract/invalid/invalid-on-failure-decision.json`
  - `docs/spec/examples/verificationcontract/invalid/pass-ratio-out-of-range.json`
  - `docs/spec/examples/verificationcontract/invalid/tests-without-required-check.json`
