# RFC-001: Stable Public Contracts

- Status: Draft
- Authors: @TomoFromEarth
- Created: 2026-02-20
- Supersedes: N/A
- Superseded-By: N/A

## Summary
Define versioned, long-term stable interface contracts that decouple language semantics, runtime behavior, and target generation.

## Motivation
Without stable contracts, compiler/runtime changes can break adapters, tooling, and benchmarks. Versioned contracts create predictable integration boundaries for contributors.

## Goals
- Specify canonical contract set and responsibilities.
- Establish compatibility and versioning rules.
- Enable framework-agnostic target generation.

## Non-Goals
- Complete field-level schema definitions for every contract in this RFC.
- Adapter-specific implementation details.

## Proposal
### Contract Set
1. `SemanticIR`
   - Canonical framework-agnostic execution and compilation graph.
   - Separates deterministic nodes from stochastic inference nodes.
   - Captures dependencies, constraints, and trace anchors.

2. `FeedbackTensor`
   - Normalized payload for failures, repair hypotheses, confidence, and memory.
   - Inputs reliability and repair loops.

3. `PolicyProfile`
   - Environment-aware safety, approval, and compliance constraints.
   - Defines allowed capabilities and escalation requirements.

4. `VerificationContract`
   - Required checks for autonomous continuation.
   - Includes tests, static analysis rules, policy assertions, and acceptance thresholds.

5. `TargetAdapter`
   - Input: `SemanticIR` + project constraints + ecosystem profile.
   - Output: human-owned source artifacts + build metadata + traceability map.

6. `CapabilityManifest`
   - Declares each adapter/runtime capability surface.
   - Enables compile-time and runtime capability validation.

### Versioning
- Use explicit semantic versions per contract family.
- Breaking changes require RFC and migration notes.
- Runtime must reject incompatible major versions.

### Compatibility Rules
- Compiler emits contract versions in artifacts.
- Runtime validates version compatibility before execution.
- Adapters declare supported contract ranges.

## Public Interface Impact
This RFC defines the initial project integration boundary and future compatibility process for all major components.

## Security and Safety
- Policy and verification contracts are mandatory for autonomy.
- Capability manifests prevent unapproved side effects.
- Contract validation failures are hard-stops, not warnings.

## Alternatives Considered
- Implicit interfaces with no formal versioning.
  Rejected: brittle integrations and unclear breakage boundaries.
- Single monolithic mega-contract.
  Rejected: poor evolution ergonomics and coupling.

## Rollout Plan
- Phase 0: publish minimal JSON schema drafts for each contract.
- Phase 1: wire validation into compiler/runtime pipeline.
- Phase 2+: extend fields with additive compatibility.

## Testing and Verification
- Contract schema validation tests.
- Compatibility matrix tests across compiler/runtime/adapter versions.
- Negative tests for unsupported versions and capability violations.

## Risks and Tradeoffs
- Additional maintenance overhead for contract governance.
- Requires strict discipline on migration tooling.

## Open Questions
- Preferred schema format for canonical publication (JSON Schema vs IDL).
- Enforcement location split between compiler and runtime.
