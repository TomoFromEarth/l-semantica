# FeedbackTensor v1

FeedbackTensor v1 is the first machine-readable contract draft for runtime reliability feedback in M1.

## Contract Goals
- Enforce explicit versioning through `schema_version`.
- Capture normalized failure signals for runtime and repair-loop decisions.
- Encode confidence, alternatives, and proposed repair action in a stable payload.
- Preserve provenance links back to runtime runs and contract versions.

## Contract Shape (v1)
- `schema_version` (required): fixed to `1.0.0`.
- `feedback_id` (required): non-empty identifier for the feedback event.
- `generated_at` (required): RFC3339/ISO-8601 `date-time` timestamp string produced by runtime.
- `failure_signal` (required object):
  - `class` (required enum): `parse`, `schema_contract`, `policy_gate`, `capability_denied`, `deterministic_runtime`, or `stochastic_extraction_uncertainty`.
  - `stage` (required enum): `compile`, `runtime`, `policy`, `capability`, or `repair`.
  - `summary` (required): non-empty short failure description.
  - `continuation_allowed` (required): boolean continuation decision from this signal.
  - `error_code` (optional): non-empty implementation-specific code.
- `confidence` (required object):
  - `score` (required): number in `[0, 1]`.
  - `rationale` (required): non-empty confidence explanation.
  - `calibration_band` (optional enum): `low`, `medium`, or `high`.
- `alternatives` (required array): at least one repair/response alternative.
- `proposed_repair_action` (required object):
  - `action` (required enum): `retry_with_patch`, `adjust_prompt`, `request_manual_review`, or `abort`.
  - `rationale` (required): non-empty reason for chosen action.
  - `requires_human_approval` (required): whether this action must be human-approved.
  - `target` and `patch_excerpt` (optional): scoped repair metadata.
- `provenance` (required object):
  - `run_id` (required): non-empty runtime run identifier.
  - `source_stage` (required enum): `runtime`, `repair_loop`, or `policy_gate`.
  - `trace_entry_id` (optional): trace ledger linkage identifier.
  - `contract_versions` (required object): non-empty `semantic_ir`, `policy_profile`, and `feedback_tensor` version fields.

## Compatibility and Versioning Notes
- FeedbackTensor v1 uses semantic version `1.0.0` for the first stable major-family draft.
- Consumers using this schema draft must reject any payload where `schema_version` is not exactly `1.0.0`.
- Additive changes should be introduced via a new published schema/doc revision (for example, a future `1.x` file) with explicit compatibility notes.
- Any field removal, required-field addition, enum narrowing, or semantic reinterpretation requires a major version bump and migration notes.

## Runtime Validation Contract
- Runtime-side schema tests must validate all committed valid fixtures and reject all committed invalid fixtures.
- Rejection output must include actionable field-level details (path/keyword/message snippets) to support debugging.
- Schema conformance is a hard requirement before downstream repair-loop or trace-inspection consumers process payloads.

## Files
- Schema: `docs/spec/schemas/feedbacktensor-v1.schema.json`
- Valid examples:
  - `docs/spec/examples/feedbacktensor/valid/recoverable-parse-repair.json`
  - `docs/spec/examples/feedbacktensor/valid/non-recoverable-policy-gate.json`
- Invalid examples:
  - `docs/spec/examples/feedbacktensor/invalid/missing-schema-version.json`
  - `docs/spec/examples/feedbacktensor/invalid/confidence-score-out-of-range.json`
  - `docs/spec/examples/feedbacktensor/invalid/proposed-repair-action-missing-rationale.json`
  - `docs/spec/examples/feedbacktensor/invalid/invalid-generated-at-format.json`
