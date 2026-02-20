# RFC-000: Vision and Principles

- Status: Draft
- Authors: @TomoFromEarth
- Created: 2026-02-20
- Supersedes: N/A
- Superseded-By: N/A

## Summary
Define L-Semantica as an LLM-native language and compiler/runtime stack for reliable, policy-governed, token-efficient software execution and generation.

## Motivation
General-purpose languages were designed for human-first workflows and treat uncertainty, tool permissions, and verification as secondary concerns. L-Semantica makes these first-class so autonomous systems can be safer, cheaper, and more reproducible.

## Goals
- Establish the project north star and non-negotiable principles.
- Lock gate-based execution phases for program delivery.
- Align architecture toward framework-agnostic, human-owned outputs.

## Non-Goals
- Final syntax design.
- Final optimizer strategy.
- Full production-grade runtime in this RFC.

## Proposal
### North Star
L-Semantica is a durable conduit from human intent to deployable software under explicit policy and verification constraints.

### Primary Outcomes
- Cross-platform generation via multi-target adapters.
- High reliability under autonomous execution.
- Major token-efficiency gains (`5x` on legacy tasks, `10x` on end-to-end product tasks).

### Non-Negotiable Principles
- Goal-first programs with explicit success/failure/stop conditions.
- Deterministic core with explicit stochastic inference edges.
- First-class uncertainty and confidence-carrying values.
- Typed, permissioned capability model.
- First-class provenance and replayability.
- Progressive autonomy with policy and verification gates.
- Framework/toolchain choices externalized as policy/config.
- Human-owned generated artifacts.

### Program Phases and Gates
1. Phase 0: Semantic Kernel.
2. Phase 1: Reliability Engine.
3. Phase 2: Legacy Continuation (priority).
4. Phase 3: Service/App Logic Generation.
5. Phase 4: Multi-Target AOT Product Generation.
6. Phase 5: Autonomous Product Evolution.

Each phase must pass explicit quality, policy, and benchmark gates before advancing.

### Phase 0 Deliverable Mapping

| Deliverable | Definition of Done | Verification Evidence |
| --- | --- | --- |
| `.ls` grammar (v0) | Grammar is documented and parser accepts baseline examples with source spans in diagnostics. | RFC/spec section plus parser tests for valid/invalid samples. |
| `SemanticIR` (v1) | Canonical IR shape is versioned and distinguishes deterministic vs stochastic nodes. | Versioned schema draft and lowering-path fixture tests. |
| Runtime `v0` | Runtime executes baseline deterministic workflows with policy hooks and non-invasive trace emission. | Runtime execution tests, policy-gate tests, and replay baseline tests. |
| `FeedbackTensor` (v1) | Failure/repair/confidence payload contract is versioned and consumable by repair loops. | Versioned schema draft and serialization round-trip tests. |
| Persistent trace ledger | Runtime writes machine-readable invocation trace entries using a versioned contract. | Ledger schema, runtime emission tests, and failure-path emission coverage. |

### Decision and Approval Path
RFC-000 uses a three-state lifecycle: `Draft -> Proposed -> Accepted`.

To move from `Proposed` to `Accepted`, all of the following are required:
1. Primary approver: repository owner (`@TomoFromEarth`).
2. Secondary approver: one maintainer accountable for implementation impact (`compiler`, `runtime`, or `spec`). During solo-maintainer periods, the owner may satisfy both roles and must note dual-role approval in the acceptance record.
3. Acceptance record in the linked issue or PR with the date (UTC), commit SHA, and confirmation that all acceptance criteria are met.

## Acceptance Criteria
RFC-000 is ready for acceptance only when all criteria below are true:
1. This document includes `Phase 0 Deliverable Mapping` with all five Semantic Kernel deliverables and objective verification evidence.
2. This document includes `Decision and Approval Path` with named approver roles, lifecycle states, and acceptance-record requirements.
3. Phase order and advancement rule are explicit: no phase advances without quality, policy, and benchmark gate completion.
4. Phase 0 deliverables map to concrete artifacts under `/rfcs`, `/docs/spec`, `/runtime`, `/compiler`, or `/benchmarks` (implemented now or tracked as explicitly linked follow-up issues).
5. The acceptance record references the issue/PR that satisfied this checklist.

## Public Interface Impact
Defines the need for stable contracts formalized in RFC-001:
- `SemanticIR`
- `FeedbackTensor`
- `PolicyProfile`
- `VerificationContract`
- `TargetAdapter`
- `CapabilityManifest`

## Security and Safety
- Mandatory policy checks before high-impact actions.
- Audit trail for execution, repair decisions, and policy outcomes.
- Kill switches and rollback paths required across phases.

## Alternatives Considered
- Model-as-orchestrator only with no language/runtime layer.
  Rejected: poor reproducibility and weak interface stability.
- Hardcoded framework semantics.
  Rejected: long-term lock-in and reduced portability.

## Rollout Plan
- Accept RFC-000 and RFC-001 before major implementation.
- Build parser/runtime skeleton after stable contracts are drafted.
- Enforce benchmark and replay tests in CI as capabilities mature.

## Testing and Verification
- Deterministic replay tests for baseline flows.
- Policy-gate blocking tests.
- Benchmark harness with baseline comparisons to Python/TS flows.

## Risks and Tradeoffs
- Upfront design rigor increases early velocity cost.
- Strong contracts may require careful migration discipline.

## Open Questions
- Minimal syntax surface for MVP.
- Versioning policy for contract evolution.
