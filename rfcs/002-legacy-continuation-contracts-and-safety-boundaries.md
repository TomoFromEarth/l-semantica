# RFC-002: Legacy Continuation Contracts and Safety Boundaries

- Status: Draft
- Authors: @TomoFromEarth, Codex
- Created: 2026-02-22
- Supersedes: N/A
- Superseded-By: N/A

## Summary
Define the M2 legacy-continuation contract boundary: versioned artifacts, required provenance/traceability fields, safety stop/escalation rules, apply/rollback gating requirements, and benchmark quality-floor validity rules.

## Motivation
Phase 2 introduces legacy-repo continuation across ingestion, intent mapping, diff planning, patch generation, PR-equivalent packaging, benchmarking, and apply/rollback controls. Without an explicit contract and safety boundary, M2 can sprawl into unsafe patch flows and produce invalid benchmark gains that appear green while quality regresses.

## Goals
- Define versioned artifact contracts and required shared metadata for M2 stages.
- Define explicit blocked actions and required checks before autonomous continuation or apply.
- Define benchmark quality-floor validity rules so `>=5x` efficiency only counts when quality is preserved.
- Provide implementation boundaries and issue mapping for `#50` through `#56`.

## Non-Goals
- Implementing ingestion, mapping, planning, patch generation, or apply/rollback runtime code.
- Final field-level JSON schemas for every artifact (this RFC defines canonical payload shape and required fields).
- Changing M1 reliability gate thresholds or semantics.

## Proposal
### M2 Safety Boundary (Normative)
M2 operates in an artifact-first mode. Stages `#50` through `#54` must produce machine-readable, human-inspectable artifacts and may not directly mutate external repositories by default.

Default boundary rules:
1. `#50`-`#54` output artifacts only; no direct external apply, push, merge, or remote mutation.
2. Any autonomous continuation decision must be reason-coded as `continue`, `escalate`, or `stop`.
3. Missing required evidence is a hard-stop, not a warning, for autonomous paths.
4. Runtime/policy enforcement is the final authority for action-time decisions, even if earlier stages passed.

### Canonical M2 Artifact Families and Versions
M2 defines the following canonical artifact families with initial schema versions:

| Artifact Family | Canonical `artifact_type` | Initial `schema_version` | Primary Producer | Primary Consumer | Implementation Issue |
| --- | --- | --- | --- | --- | --- |
| Workspace Snapshot | `ls.m2.workspace_snapshot` | `1.0.0` | Repository ingestion | Intent mapper, planner | `#50` |
| Intent Mapping | `ls.m2.intent_mapping` | `1.0.0` | AST-aware mapper | Diff planner, patch generator | `#51` |
| Safe Diff Plan | `ls.m2.safe_diff_plan` | `1.0.0` | Diff planner | Patch generator, PR bundle builder | `#52` |
| Patch Run Record | `ls.m2.patch_run` | `1.0.0` | Patch generator + verification gate | PR bundle builder, apply controller | `#53` |
| PR-Equivalent Bundle | `ls.m2.pr_bundle` | `1.0.0` | PR-equivalent artifact builder | Human reviewer, apply/rollback controller | `#54` |
| Legacy Benchmark Report | `ls.m2.legacy_benchmark_report` | `1.0.0` | Benchmark harness | CI gate, tracker completion | `#55` |
| Apply/Rollback Record | `ls.m2.apply_rollback_record` | `1.0.0` | Apply/rollback controller | Trace/reporting, reliability validation | `#56` |

### Shared Artifact Envelope (Required)
All M2 artifacts must include the following top-level envelope fields:

- `artifact_type` (string): canonical family identifier (table above).
- `schema_version` (string): `MAJOR.MINOR.PATCH`.
- `artifact_id` (string): unique ID for this artifact instance.
- `run_id` (string): stable identifier for the end-to-end M2 run that produced the artifact.
- `produced_at_utc` (string): RFC3339 UTC timestamp.
- `tool_version` (string): producer version/build identifier.
- `inputs` (array): upstream artifact references with `artifact_id`, `artifact_type`, and `schema_version`.
- `trace` (object): provenance references sufficient to reconstruct lineage and gating decisions.
- `payload` (object): artifact-family-specific data.

Required behavior:
1. Consumers must validate `artifact_type` and `schema_version` before reading `payload`.
2. Unsupported major versions are hard-fail.
3. Autonomous paths must reject artifacts with missing envelope fields.
4. Every downstream artifact must reference all decision-relevant upstream artifacts in `inputs`.

### Stage Outcomes and Reason Codes (Normative)
M2 stages that make safety decisions (`#51`, `#52`, `#53`, `#56`) must emit:

- `decision`: one of `continue`, `escalate`, `stop`
- `reason_code`: stable machine-readable code
- `reason_detail`: human-readable summary

Minimum cross-stage reason-code set:
- `ok` (success path when `decision=continue`)
- `unsupported_input`
- `mapping_ambiguous`
- `mapping_low_confidence`
- `forbidden_path`
- `change_bound_exceeded`
- `conflict_detected`
- `verification_failed`
- `verification_incomplete`
- `policy_blocked`
- `rollback_unavailable`
- `undeclared_capability`
- `benchmark_quality_floor_failed`
- `benchmark_invalid_gain`

Stages may add artifact-specific codes, but must not overload these codes with different meanings.

### Versioned Payload Examples (Normative Examples)
The following examples are canonical shape examples for M2 implementation work. Field additions may be introduced in minor versions; required fields in these examples establish the `1.0.0` baseline.

#### Example: `ls.m2.workspace_snapshot@1.0.0` (`#50`)
```json
{
  "artifact_type": "ls.m2.workspace_snapshot",
  "schema_version": "1.0.0",
  "artifact_id": "wsnap_01",
  "run_id": "run_m2_20260222_0001",
  "produced_at_utc": "2026-02-22T12:00:00Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [],
  "trace": {
    "workspace_root": "/repo",
    "source": "local_git_worktree"
  },
  "payload": {
    "git": {
      "head_sha": "36355dd",
      "branch": "main",
      "is_dirty": false
    },
    "inventory": {
      "files_scanned": 214,
      "files_supported": 171,
      "languages": ["TypeScript", "Markdown", "JSON"]
    },
    "filters": {
      "ignored_paths": ["node_modules/**", ".git/**"]
    },
    "snapshot_hash": "sha256:..."
  }
}
```

#### Example: `ls.m2.intent_mapping@1.0.0` (`#51`)
```json
{
  "artifact_type": "ls.m2.intent_mapping",
  "schema_version": "1.0.0",
  "artifact_id": "imap_01",
  "run_id": "run_m2_20260222_0001",
  "produced_at_utc": "2026-02-22T12:00:05Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "wsnap_01",
      "artifact_type": "ls.m2.workspace_snapshot",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "intent_source": "user_prompt",
    "extraction_methods": ["ast_symbol_lookup", "text_match"]
  },
  "payload": {
    "intent": {
      "summary": "Add RFC for M2 contracts and safety boundaries"
    },
    "candidates": [
      {
        "target_id": "rfcs/new_rfc",
        "path": "rfcs/002-legacy-continuation-contracts-and-safety-boundaries.md",
        "symbol_path": null,
        "confidence": 0.99,
        "rationale": "New RFC file in canonical directory",
        "provenance": {
          "source_path": "rfcs/",
          "method": "repo_convention"
        }
      }
    ],
    "alternatives": [],
    "decision": "continue",
    "reason_code": "ok",
    "reason_detail": "Single high-confidence target selected"
  }
}
```

#### Example: `ls.m2.safe_diff_plan@1.0.0` (`#52`)
```json
{
  "artifact_type": "ls.m2.safe_diff_plan",
  "schema_version": "1.0.0",
  "artifact_id": "dplan_01",
  "run_id": "run_m2_20260222_0001",
  "produced_at_utc": "2026-02-22T12:00:10Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "imap_01",
      "artifact_type": "ls.m2.intent_mapping",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "planner_profile": "default-conservative"
  },
  "payload": {
    "edits": [
      {
        "path": "rfcs/002-legacy-continuation-contracts-and-safety-boundaries.md",
        "operation": "create",
        "justification": "Issue #49 RFC"
      }
    ],
    "safety_checks": {
      "forbidden_path_patterns": [],
      "max_file_changes": {
        "limit": 5,
        "observed": 1
      },
      "max_hunks": {
        "limit": 20,
        "observed": 1
      }
    },
    "decision": "continue",
    "reason_code": "ok",
    "reason_detail": "Plan is within conservative safety bounds"
  }
}
```

#### Example: `ls.m2.patch_run@1.0.0` (`#53`)
```json
{
  "artifact_type": "ls.m2.patch_run",
  "schema_version": "1.0.0",
  "artifact_id": "patch_01",
  "run_id": "run_m2_20260222_0001",
  "produced_at_utc": "2026-02-22T12:00:20Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "dplan_01",
      "artifact_type": "ls.m2.safe_diff_plan",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "patch_materialization": "deterministic_text_patch_v1"
  },
  "payload": {
    "patch_digest": "sha256:...",
    "verification": {
      "required_checks": ["lint", "typecheck", "test"],
      "results": [
        { "check": "lint", "status": "pass" },
        { "check": "typecheck", "status": "pass" },
        { "check": "test", "status": "pass" }
      ],
      "evidence_complete": true
    },
    "decision": "continue",
    "reason_code": "ok",
    "reason_detail": "All required checks passed with complete evidence"
  }
}
```

#### Example: `ls.m2.pr_bundle@1.0.0` (`#54`)
```json
{
  "artifact_type": "ls.m2.pr_bundle",
  "schema_version": "1.0.0",
  "artifact_id": "prb_01",
  "run_id": "run_m2_20260222_0001",
  "produced_at_utc": "2026-02-22T12:00:30Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "patch_01",
      "artifact_type": "ls.m2.patch_run",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "lineage": ["wsnap_01", "imap_01", "dplan_01", "patch_01"]
  },
  "payload": {
    "summary": "Draft RFC-002 for M2 contracts and safety boundaries",
    "patch": {
      "format": "unified_diff",
      "digest": "sha256:..."
    },
    "risk_tradeoffs": [
      "Defines contract names early; field-level schemas remain follow-up work"
    ],
    "verification_evidence_ref": "patch_01",
    "rollback": {
      "strategy": "reverse_patch",
      "supported": true,
      "package_ref": "rollback_pkg_01"
    }
  }
}
```

#### Example: `ls.m2.legacy_benchmark_report@1.0.0` (`#55`)
```json
{
  "artifact_type": "ls.m2.legacy_benchmark_report",
  "schema_version": "1.0.0",
  "artifact_id": "bm_01",
  "run_id": "run_m2_bench_20260222_0001",
  "produced_at_utc": "2026-02-22T12:30:00Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "prb_01",
      "artifact_type": "ls.m2.pr_bundle",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "suite_id": "legacy-continuation.v1"
  },
  "payload": {
    "tasks": [
      {
        "task_id": "repo_task_01",
        "efficiency_ratio": 5.7,
        "quality_floor": {
          "status": "pass",
          "invalid_gain_reasons": []
        }
      }
    ],
    "aggregates": {
      "median_efficiency_ratio": 5.4,
      "p90_efficiency_ratio": 4.8
    },
    "quality_floor_summary": {
      "status": "pass",
      "invalid_gain_reasons": []
    },
    "m2_objective_evaluation": {
      "efficiency_target_met": true,
      "quality_floor_preserved": true,
      "valid_gain": true
    }
  }
}
```

#### Example: `ls.m2.apply_rollback_record@1.0.0` (`#56`)
```json
{
  "artifact_type": "ls.m2.apply_rollback_record",
  "schema_version": "1.0.0",
  "artifact_id": "apply_01",
  "run_id": "run_m2_apply_20260222_0001",
  "produced_at_utc": "2026-02-22T13:00:00Z",
  "tool_version": "l-semantica@0.1.0-dev",
  "inputs": [
    {
      "artifact_id": "prb_01",
      "artifact_type": "ls.m2.pr_bundle",
      "schema_version": "1.0.0"
    }
  ],
  "trace": {
    "policy_profile_ref": "policy.local-dev.v1",
    "verification_contract_ref": "verification.m2.v1"
  },
  "payload": {
    "action": "apply",
    "decision": "escalate",
    "reason_code": "policy_blocked",
    "reason_detail": "Explicit approval missing for external repo mutation",
    "rollback": {
      "available": true,
      "strategy": "reverse_patch"
    }
  }
}
```

### Policy Constraints and Blocked Actions (Normative)
The following actions are hard-blocked on autonomous paths unless a later stage explicitly declares a supported capability and policy allows it:

Hard-blocked by default:
1. Direct mutation of repositories outside the declared workspace root.
2. Networked VCS mutations (`push`, `merge`, remote branch mutation) without explicit policy capability and approval evidence.
3. Reading or writing known secret-bearing paths (for example `.env*`, credential stores, key files) unless explicitly requested and policy-approved.
4. Execution or application when required verification evidence is missing or incomplete.
5. Apply operations when rollback support is unavailable for the selected strategy.

Escalation-required (must emit `decision=escalate`, not `continue`):
1. Edits to CI/workflow files, policy files, or security-sensitive configuration.
2. Changes exceeding planner bounds (files/hunks/bytes) even if technically patchable.
3. Ambiguous or low-confidence intent mappings.
4. Unsupported language regions or binary/opaque file edits.
5. Undeclared capability usage.

### Required Checks Before Continuation and Apply (Normative)
Before autonomous continuation (`#53`) or apply/rollback (`#56`), the following checks are required:

| Stage | Required Checks | Failure Behavior |
| --- | --- | --- |
| Patch generation continuation (`#53`) | Diff plan decision `continue`; required checks list present; all required checks completed; no failing required checks; evidence links complete | `stop` on failed/incomplete verification; `escalate` on policy-sensitive paths |
| PR-equivalent bundle readiness (`#54`) | Patch digest present; change rationale present; risk/tradeoff summary present; verification evidence linked; rollback package/instructions present; lineage trace complete | `stop` |
| Apply (`#56`) | Policy allows action; verification evidence complete and passing; PR bundle completeness validated; rollback available; target state matches expected preconditions; explicit approval evidence when required | `stop` or `escalate` (never implicit continue on missing evidence) |
| Rollback (`#56`) | Prior apply record exists; rollback package validated; target state matches rollback preconditions | `stop` on mismatch or missing rollback package |

### Benchmark Quality Floor and Validity Rules (Normative)
The M2 `>=5x` efficiency goal is only valid when the quality floor is preserved.

Required benchmark report behavior (`#55`):
1. Report per-task `efficiency_ratio = baseline_tokens / ls_tokens`.
2. Report aggregate `median_efficiency_ratio` and `p90_efficiency_ratio`.
3. Report per-task and aggregate quality-floor status with machine-readable invalid-gain reasons.
4. Mark a task gain invalid when efficiency improves but quality-floor checks fail.
5. As a downstream artifact, include decision-relevant benchmarked artifact references in `inputs` (for example `pr_bundle` and/or `patch_run` refs).

Minimum quality-floor requirements for a valid task gain:
1. Required tests/checks pass for the task scenario.
2. Policy assertions and blocked-action constraints are satisfied.
3. Acceptance criteria for the benchmark task are met (correctness/behavioral equivalence as defined by the suite).
4. Required provenance/traceability artifacts are present and linkable.
5. No unsupported bypasses (for example skipped required checks without policy allowance).

Minimum invalid-gain reasons (`invalid_gain_reasons`):
- `required_checks_failed`
- `required_checks_incomplete`
- `policy_violation`
- `acceptance_criteria_failed`
- `traceability_incomplete`
- `unsupported_bypass`
- `artifact_contract_invalid`

M2 objective evaluation rule for tracker `#48`:
- `efficiency_target_met` is true when the benchmark suite aggregate `median_efficiency_ratio >= 5.0`.
- `quality_floor_preserved` is true only when aggregate quality-floor status is `pass`.
- A reported `>=5x` gain is not counted for M2 completion when `valid_gain=false`, regardless of raw efficiency ratios.

### Issue Mapping and Deferred Implementation Boundaries
This RFC intentionally defines boundaries and contracts while deferring implementation details to the tracker-ordered M2 issues:

- `#50` Repository ingestion + normalized snapshot artifact ([Issue #50](https://github.com/TomoFromEarth/l-semantica/issues/50))
- `#51` AST-aware intent mapping with confidence/provenance ([Issue #51](https://github.com/TomoFromEarth/l-semantica/issues/51))
- `#52` Safe diff planning and decision outcomes ([Issue #52](https://github.com/TomoFromEarth/l-semantica/issues/52))
- `#53` CI/test-aware patch generation + verification gating ([Issue #53](https://github.com/TomoFromEarth/l-semantica/issues/53))
- `#54` PR-equivalent bundle + rollback package ([Issue #54](https://github.com/TomoFromEarth/l-semantica/issues/54))
- `#55` Legacy continuation benchmark suite + efficiency/quality gates ([Issue #55](https://github.com/TomoFromEarth/l-semantica/issues/55))
- `#56` Policy-governed apply/rollback controls + reliability validation ([Issue #56](https://github.com/TomoFromEarth/l-semantica/issues/56))

Tracker reference:
- [M2 Tracker #48](https://github.com/TomoFromEarth/l-semantica/issues/48)

## Public Interface Impact
This RFC defines M2 internal artifact contracts and safety decision semantics that future runtime/compiler components will consume.

Impact on existing contract families:
- `SemanticIR`: no schema change in this RFC.
- `FeedbackTensor`: no schema change in this RFC; M2 artifacts may reference feedback/trace outputs as evidence.
- `PolicyProfile`: clarifies required apply/autonomy gate inputs and blocked-action enforcement semantics for M2.
- `VerificationContract`: clarifies required evidence completeness and fail-closed behavior for M2 continuation/apply paths.
- `TargetAdapter`: no change in M2 scope.
- `CapabilityManifest`: informs undeclared-capability blocking semantics for M2 actions.

## Security and Safety
Threats addressed:
- Unsafe patch/application from ambiguous intent mappings.
- Silent continuation with missing verification evidence.
- Invalid benchmark gains caused by quality regressions or bypassed checks.
- High-impact repo mutations without explicit policy/approval control.

Mitigations:
- Reason-coded fail-closed decisions (`continue`/`escalate`/`stop`).
- Mandatory provenance and artifact lineage.
- Explicit blocked-action list and escalation semantics.
- Benchmark invalid-gain reporting requirements.

## Alternatives Considered
- Deferring artifact contract definitions to each implementation issue.
  Rejected: increases drift and breaks tracker-order parallelization.
- One monolithic end-to-end payload instead of stage artifacts.
  Rejected: weak provenance boundaries and poorer testability.
- Counting `>=5x` efficiency without quality-floor validity markers.
  Rejected: incentivizes unsafe or incomplete flows.

## Rollout Plan
1. Merge this RFC with maintainer acceptance for M2 boundary lock-in.
2. Implement `#50`-`#56` in tracker order (parallelizing only where declared safe in `#48`).
3. Add field-level schemas/tests/docs per implementation issue while preserving artifact family names and versioning rules from this RFC.
4. Tighten policy/profile thresholds in follow-up RFCs if M2 execution reveals gaps.

## Testing and Verification
This RFC is verified by downstream implementation tests and docs, not executable code in this change alone.

Required downstream verification coverage:
- Schema/loader validation for artifact envelopes and versions.
- Negative tests for blocked actions, missing evidence, and invalid-gain reporting.
- Determinism/replay tests for snapshot, patch generation, and apply/rollback paths.
- Benchmark report tests for median/p90 and `valid_gain` semantics.

## Risks and Tradeoffs
- Early contract naming may require later RFC revision if implementation reveals missing abstractions.
- Fail-closed defaults may slow early iteration but reduce unsafe continuation risk.
- Versioned artifact expectations increase maintenance overhead across M2 stages.

## Open Questions
- Should M2 final gate require an additional p90 threshold beyond reporting (for example `p90 >= X`) in addition to `median >= 5.0`?
- Should security-sensitive path classes be centrally defined in `PolicyProfile` or duplicated in planner/apply controllers with shared tests?
