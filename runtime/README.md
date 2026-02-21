# Runtime

Execution engine, policy enforcement, and replay support.

## Contract Specs
- `docs/spec/semanticir-v0.md`
- `docs/spec/policyprofile-v0.md`
- `docs/spec/feedbacktensor-v1.md`
- `docs/spec/verificationcontract-v1.md`
- `docs/spec/trace-ledger-v0.md`

## Contract Loader
- `loadRuntimeContracts(input)` validates `semanticIr`, `policyProfile`, and `verificationContract` payloads against published schema versions.
- Validation failures use `ContractValidationError` with:
  - `code`: `INVALID_INPUT`, `SCHEMA_VALIDATION_FAILED`, or `VERSION_INCOMPATIBLE`
  - `contract`: `RuntimeContracts`, `SemanticIR`, `PolicyProfile`, or `VerificationContract`
  - `issues`: field-level validation details (`instancePath`, `keyword`, `message`)
- Setup failures (for example unreadable schema files or resolver initialization failures) may throw standard `Error`.

## Continuation Gate
- `runSemanticIr(ir, options)` returns `continuationDecision` when the gate allows continuation (`continue`).
- If the gate decides `escalate` or `stop`, runtime throws `RuntimeContinuationGateError`; the blocked decision and reason code are available on the error instance.
- Configure gate evaluation through `options.continuationGate`:
  - `verificationContract` (required): applies `continuation` behavior and pass criteria thresholds.
  - `policyProfile` (optional): required when `verificationContract.continuation.require_policy_profile` is `true`.
  - `verificationStatus` (optional): check results plus warning count; missing/incomplete summaries block autonomous continuation.
  - `feedbackTensor` (optional input, effectively required for pass): missing required fields listed by `required_feedback_tensor_fields` block autonomous continuation.
- `evaluateContinuationGate(...)` is exported for deterministic, testable policy + verification gating without invoking runtime execution.

## Repair Loop
- `runRuleFirstRepairLoop(input, options)` executes deterministic rule-first repair over known M1 failure classes.
- Rule order is stable and exported as `RULE_FIRST_REPAIR_ORDER`.
- Retry behavior is bounded by `options.maxAttempts` (default `2`, hard cap `10`).
- FeedbackTensor emission is opt-in via `options.feedbackTensorPath` and emits one terminal repair outcome record per invocation.
- Repair FeedbackTensor emission supports run-linkage fields via `options.runId` (or `options.runIdFactory`) and optional `options.traceEntryId`.
- Terminal outcomes are explicit and reason-coded:
  - `repaired`: deterministic recovery succeeded and `continuationAllowed` is `true`.
  - `escalate`: no safe deterministic repair path exists and human escalation is required.
  - `stop`: bounded retries exhausted or hard-stop policy/runtime invariants were hit.

## Trace Ledger
- `runSemanticIr(ir, options)` emits one trace ledger entry per invocation.
- Set `options.traceLedgerPath` to append JSON-lines records to a file.
- Set `options.feedbackTensorPath` to append FeedbackTensor v1 JSON-lines records for failed runtime invocations.
- Trace ledger emission is best-effort: write failures do not fail `runSemanticIr`.
- FeedbackTensor emission is best-effort: write failures do not fail `runSemanticIr` or `runRuleFirstRepairLoop`.
- Runtime FeedbackTensor `provenance.trace_entry_id` is populated only when trace-ledger append succeeds.
- Hook evaluation (`runIdFactory`, `now`) occurs only when trace or feedback emission is enabled.
- `run_id` is normalized to a non-empty value before emission.
- Timestamp hooks are best-effort: invalid/throwing `options.now` values fall back to runtime clock time.
- Each entry includes:
  - `run_id`
  - `started_at` and `completed_at`
  - `contract_versions.semantic_ir` and `contract_versions.policy_profile`
  - `outcome.status` (`success` or `failure`) and `outcome.error` for failure cases
