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
