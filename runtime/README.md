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
- Trace-inspection emission is opt-in via:
  - `options.traceInspectionPath` (machine-readable NDJSON)
  - `options.traceInspectionReportPath` (human-readable text report)
- Repair FeedbackTensor emission supports run-linkage fields via `options.runId` (or `options.runIdFactory`) and optional `options.traceEntryId`.
- Terminal outcomes are explicit and reason-coded:
  - `repaired`: deterministic recovery succeeded and `continuationAllowed` is `true`.
  - `escalate`: no safe deterministic repair path exists and human escalation is required.
  - `stop`: bounded retries exhausted or hard-stop policy/runtime invariants were hit.

## FeedbackTensor Confidence Semantics
- Runtime failure emission:
  - `schema_contract` failures emit `confidence.score=0.9` and `calibration_band=high`.
  - Non-schema runtime failures emit `confidence.score=0.7` and `calibration_band=medium`.
- Repair-loop terminal emission:
  - `repaired` emits `confidence.score=0.9` and `calibration_band=high`.
  - `escalate` emits `confidence.score=0.45` and `calibration_band=medium`.
  - `stop` emits `confidence.score=0.2` and `calibration_band=low`.

## Trace Ledger
- `runSemanticIr(ir, options)` emits one trace ledger entry per invocation.
- Set `options.traceLedgerPath` to append JSON-lines records to a file.
- Set `options.feedbackTensorPath` to append FeedbackTensor v1 JSON-lines records for failed runtime invocations.
- Set `options.traceInspectionPath` to append machine-readable trace-inspection JSON-lines records.
- Set `options.traceInspectionReportPath` to append human-readable trace-inspection report entries.
- Trace ledger emission is best-effort: write failures do not fail `runSemanticIr`.
- FeedbackTensor emission is best-effort: write failures do not fail `runSemanticIr` or `runRuleFirstRepairLoop`.
- Trace-inspection emission is best-effort: write failures do not fail `runSemanticIr` or `runRuleFirstRepairLoop`.
- Runtime FeedbackTensor `provenance.trace_entry_id` is populated only when trace-ledger append succeeds.
- Trace inspection links include:
  - trace-ledger linkage via `trace_ledger.trace_entry_id`
  - FeedbackTensor linkage via `feedback_tensor.feedback_id` and `feedback_tensor.trace_entry_id`
  - continuation-gate decision linkage via `continuation_gate.decision` and `continuation_gate.reason_code`
- Trace inspection payloads also include:
  - FeedbackTensor confidence metadata via `feedback_tensor.confidence`
  - repair outcomes and attempt timeline via `repair.{decision, reason_code, history[]}`
- Hook evaluation (`runIdFactory`, `now`) occurs only when trace, feedback, or trace-inspection emission is enabled.
- `run_id` is normalized to a non-empty value before emission.
- Timestamp hooks are best-effort: invalid/throwing `options.now` values fall back to runtime clock time.
- Each entry includes:
  - `run_id`
  - `started_at` and `completed_at`
  - `contract_versions.semantic_ir` and `contract_versions.policy_profile`
  - `outcome.status` (`success` or `failure`) and `outcome.error` for failure cases

## Workspace Snapshot (M2 `#50`)
- `createWorkspaceSnapshotArtifact({ workspaceRoot, ...options })` performs deterministic repository ingestion for a local git worktree and returns `ls.m2.workspace_snapshot@1.0.0`.
- Default ignored paths: `.git/**`, `node_modules/**`.
- The artifact follows the RFC-002 M2 envelope fields (`artifact_type`, `schema_version`, `artifact_id`, `run_id`, `produced_at_utc`, `tool_version`, `inputs`, `trace`, `payload`).
- `payload.git` includes `head_sha`, `branch`, and `is_dirty`.
- `payload.inventory` includes `files_scanned`, `files_supported`, and sorted unique `languages` detected from supported file extensions.
- `payload.filters.ignored_paths` records the effective ignore rules used during ingestion.
- `payload.snapshot_hash` is a deterministic SHA-256 hash over normalized git + inventory snapshot state.
- Deterministic tests/replays can provide `options.runIdFactory` and `options.now`.

Example:

```ts
import { createWorkspaceSnapshotArtifact } from "@l-semantica/runtime";

const snapshot = createWorkspaceSnapshotArtifact({
  workspaceRoot: process.cwd(),
  runIdFactory: () => "run_m2_20260222_0001",
  now: () => new Date("2026-02-22T12:00:00Z"),
  toolVersion: "l-semantica@0.1.0-dev"
});
```

## Intent Mapping (M2 `#51`)
- `createIntentMappingArtifact({ workspaceSnapshot, intent, ...options })` consumes `ls.m2.workspace_snapshot@1.0.0` and emits `ls.m2.intent_mapping@1.0.0`.
- The mapper reuses the upstream snapshot `run_id` by default and records the snapshot envelope in `inputs`.
- `.ls` files use compiler AST symbol lookup (`goal`, `capability`, `check`) with file/symbol/range provenance.
- Other supported text files use deterministic file-level `text_match` fallback candidates.
- `payload.candidates` contains selected targets (or ambiguous top candidates), `payload.alternatives` contains remaining ranked options.
- Guardrail outcomes are reason-coded:
  - `decision=continue` + `reason_code=ok` for a single high-confidence target.
  - `decision=escalate` + `reason_code=mapping_ambiguous` or `mapping_low_confidence` when autonomous continuation should be blocked.
  - `decision=stop` + `reason_code=unsupported_input` when no viable target matches.
- Deterministic tests/replays can provide `options.now`; confidence thresholds are configurable via `minConfidence` and `ambiguityGap`.

Example:

```ts
import {
  createIntentMappingArtifact,
  createWorkspaceSnapshotArtifact
} from "@l-semantica/runtime";

const snapshot = createWorkspaceSnapshotArtifact({
  workspaceRoot: process.cwd(),
  runIdFactory: () => "run_m2_20260222_0001",
  now: () => new Date("2026-02-22T12:00:00Z")
});

const intentMapping = createIntentMappingArtifact({
  workspaceSnapshot: snapshot,
  intent: "Update capability read_docs description to mention local RFCs",
  now: () => new Date("2026-02-22T12:00:05Z"),
  toolVersion: "l-semantica@0.1.0-dev"
});
```

## Safe Diff Plan (M2 `#52`)
- `createSafeDiffPlanArtifact({ intentMapping, ...options })` consumes `ls.m2.intent_mapping@1.0.0` and emits `ls.m2.safe_diff_plan@1.0.0`.
- The planner reuses the upstream intent-mapping `run_id` by default and records the mapping envelope in `inputs`.
- Output `payload.edits[]` is a bounded, human-inspectable plan (path, operation, justification) for downstream patch generation.
- `payload.safety_checks` records effective forbidden-path patterns and observed vs limit counts for file changes and hunks.
- Guardrail outcomes are reason-coded using RFC-002 decision semantics (`continue`, `escalate`, `stop`):
  - `decision=continue` + `reason_code=ok` when the plan stays within conservative bounds.
  - `decision=escalate` + `reason_code=change_bound_exceeded` or `conflict_detected` when human review is required.
  - `decision=stop` + `reason_code=forbidden_path` or upstream `unsupported_input` when planning is hard-blocked.
- Upstream intent-mapping blocks (`mapping_ambiguous`, `mapping_low_confidence`) are propagated without generating edits.
- The `#52` issue text mentions `proceed`; runtime follows RFC-002’s normative `continue` keyword for cross-stage consistency.
- Deterministic tests/replays can provide `options.now`; safety limits are configurable via `maxFileChanges`, `maxHunks`, and `forbiddenPathPatterns`.

Example:

```ts
import {
  createIntentMappingArtifact,
  createSafeDiffPlanArtifact,
  createWorkspaceSnapshotArtifact
} from "@l-semantica/runtime";

const snapshot = createWorkspaceSnapshotArtifact({
  workspaceRoot: process.cwd(),
  runIdFactory: () => "run_m2_20260222_0001",
  now: () => new Date("2026-02-22T12:00:00Z")
});

const intentMapping = createIntentMappingArtifact({
  workspaceSnapshot: snapshot,
  intent: "Update capability read_docs description to mention local RFCs",
  now: () => new Date("2026-02-22T12:00:05Z")
});

const safeDiffPlan = createSafeDiffPlanArtifact({
  intentMapping,
  now: () => new Date("2026-02-22T12:00:10Z"),
  toolVersion: "l-semantica@0.1.0-dev"
});
```

## Patch Run (M2 `#53`)
- `createPatchRunArtifact({ safeDiffPlan, ...options })` consumes `ls.m2.safe_diff_plan@1.0.0` and emits `ls.m2.patch_run@1.0.0`.
- The patch runner reuses the upstream safe-diff-plan `run_id` by default and records the planner envelope in `inputs`.
- `payload.patch` contains a deterministic, human-inspectable unified-diff placeholder patch for downstream packaging (`#54`) plus `payload.patch_digest`.
- `payload.verification` records required checks, normalized results, evidence completeness, and fail-closed gating summaries.
- Guardrail outcomes use RFC-002 reason-coded decisions (`continue`, `escalate`, `stop`):
  - `decision=continue` + `reason_code=ok` when all required checks pass with complete evidence.
  - `decision=stop` + `reason_code=verification_failed` when any required check fails.
  - `decision=stop` + `reason_code=verification_incomplete` when required checks/results/evidence links are incomplete.
  - `decision=escalate` + `reason_code=policy_blocked` when changes target policy-sensitive paths (for example CI/workflow or policy/spec schema files).
- Upstream safe diff plan blocks (`mapping_*`, `forbidden_path`, `change_bound_exceeded`, `conflict_detected`, `unsupported_input`) are propagated without materializing a patch.
- Deterministic tests/replays can provide `options.now`; callers can override `requiredChecks`, `verificationResults`, and `policySensitivePathPatterns`.

Example:

```ts
import {
  createIntentMappingArtifact,
  createPatchRunArtifact,
  createSafeDiffPlanArtifact,
  createWorkspaceSnapshotArtifact
} from "@l-semantica/runtime";

const snapshot = createWorkspaceSnapshotArtifact({
  workspaceRoot: process.cwd(),
  runIdFactory: () => "run_m2_20260222_0001",
  now: () => new Date("2026-02-22T12:00:00Z")
});

const intentMapping = createIntentMappingArtifact({
  workspaceSnapshot: snapshot,
  intent: "Update capability read_docs description to mention local RFCs",
  now: () => new Date("2026-02-22T12:00:05Z")
});

const safeDiffPlan = createSafeDiffPlanArtifact({
  intentMapping,
  now: () => new Date("2026-02-22T12:00:10Z")
});

const patchRun = createPatchRunArtifact({
  safeDiffPlan,
  verificationResults: [
    { check: "lint", status: "pass", evidence_ref: "artifact://lint-log" },
    { check: "typecheck", status: "pass", evidence_ref: "artifact://typecheck-log" },
    { check: "test", status: "pass", evidence_ref: "artifact://test-log" }
  ],
  now: () => new Date("2026-02-22T12:00:20Z"),
  toolVersion: "l-semantica@0.1.0-dev"
});
```

## PR Bundle (M2 `#54`)
- `createPrBundleArtifact({ patchRun, lineage, ...options })` consumes `ls.m2.patch_run@1.0.0` and emits `ls.m2.pr_bundle@1.0.0`.
- The bundle reuses the upstream patch-run `run_id` by default and can include explicit lineage artifacts (`workspaceSnapshot`, `intentMapping`, `safeDiffPlan`) for complete traceability.
- `payload.patch` embeds the patch-run patch payload (`format`, `digest`, `content`, counts) for human-inspectable PR-equivalent packaging.
- `payload.verification` carries normalized required-check results/completeness from patch-run, and `payload.verification_evidence_ref` links the verification evidence artifact (defaults to the patch-run artifact id).
- `payload.rollback` packages deterministic reverse-patch placeholder content plus rollback instructions when safe-diff-plan lineage is available.
- `payload.traceability` records the intent/mapping/diff-plan/patch outcome chain and `trace.lineage` artifact ids.
- `payload.readiness` performs RFC-002 PR-equivalent bundle completeness checks and fail-closes with `decision=stop` when required sections are missing (for example missing lineage, rollback package/instructions, or verification linkage/results).
- Patch-run `policy_blocked` outcomes can still be packaged into a bundle for human review; readiness focuses on bundle completeness, while upstream patch outcome remains recorded in `payload.traceability.patch_run_outcome`.
- Deterministic tests/replays can provide `options.now`; callers can override summary/rationale/risk tradeoffs, verification evidence ref, and rollback packaging details.

Example:

```ts
import {
  createIntentMappingArtifact,
  createPatchRunArtifact,
  createPrBundleArtifact,
  createSafeDiffPlanArtifact,
  createWorkspaceSnapshotArtifact
} from "@l-semantica/runtime";

const snapshot = createWorkspaceSnapshotArtifact({
  workspaceRoot: process.cwd(),
  runIdFactory: () => "run_m2_20260222_0001",
  now: () => new Date("2026-02-22T12:00:00Z")
});

const intentMapping = createIntentMappingArtifact({
  workspaceSnapshot: snapshot,
  intent: "Update capability read_docs description to mention local RFCs",
  now: () => new Date("2026-02-22T12:00:05Z")
});

const safeDiffPlan = createSafeDiffPlanArtifact({
  intentMapping,
  now: () => new Date("2026-02-22T12:00:10Z")
});

const patchRun = createPatchRunArtifact({
  safeDiffPlan,
  verificationResults: [
    { check: "lint", status: "pass", evidence_ref: "artifact://lint-log" },
    { check: "typecheck", status: "pass", evidence_ref: "artifact://typecheck-log" },
    { check: "test", status: "pass", evidence_ref: "artifact://test-log" }
  ],
  now: () => new Date("2026-02-22T12:00:20Z")
});

const prBundle = createPrBundleArtifact({
  patchRun,
  lineage: {
    workspaceSnapshot: snapshot,
    intentMapping,
    safeDiffPlan
  },
  now: () => new Date("2026-02-22T12:00:30Z"),
  toolVersion: "l-semantica@0.1.0-dev"
});
```
