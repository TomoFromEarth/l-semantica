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

### Contract Boundary Ownership
| Contract | Canonical Owner | Primary Producers | Primary Consumers | Required Boundary Guarantees |
| --- | --- | --- | --- | --- |
| `SemanticIR` | Compiler | Compiler lowering pipeline | Runtime, `TargetAdapter` implementations | Compiler guarantees semantic correctness and schema-conformant emission; runtime/adapters treat as read-only input and must reject incompatible versions. |
| `FeedbackTensor` | Runtime reliability pipeline | Runtime execution/repair subsystems | Compiler repair planner, observability/reporting tools | Runtime guarantees normalized failure/repair/confidence payloads; consumers must validate schema/version before decision use. |
| `PolicyProfile` | Policy governance layer | Policy authors, environment config loaders | Compiler (static checks), runtime (dynamic enforcement) | Compiler enforces static capability/budget constraints; runtime is final authority for action-time policy gates. |
| `VerificationContract` | Verification governance layer | Spec/quality owners, toolchain config | Compiler, runtime, CI pipeline | Compiler validates contract references and static check declarations; runtime enforces blocking continuation semantics at execution time. |
| `TargetAdapter` | Adapter implementation owner | Adapter packages | Build pipeline, deploy pipeline, downstream maintainers | Adapters must consume `SemanticIR` + constraints and emit human-owned artifacts plus build metadata and traceability mapping. |
| `CapabilityManifest` | Adapter/runtime package owner | Adapter/runtime maintainers | Compiler and runtime policy enforcement paths | Compiler must reject plans requiring undeclared capabilities; runtime must block undeclared or disallowed capability invocation. |

### Versioning
- Use explicit semantic versions per contract family.
- Breaking changes require RFC and migration notes.
- Compiler, runtime, and adapters must reject incompatible major versions.

Contract versions use `MAJOR.MINOR.PATCH` with the following required behavior:
- `MAJOR`: breaking field or semantic changes. Consumers must reject artifacts with different major versions.
- `MINOR`: additive, backwards-compatible changes. Consumers that support minor `N` must accept all artifacts in the same major with minor `<= N`.
- `PATCH`: non-breaking corrections/clarifications that do not change compatibility semantics.

### Compatibility Rules
- Compiler emits contract versions in artifacts.
- Runtime validates version compatibility before execution.
- Adapters declare supported contract ranges.

Additional compatibility requirements:
1. Every artifact must include explicit versions for all applicable contracts.
2. Compiler, runtime, and adapters must each publish supported version ranges per contract family.
3. Version negotiation is deterministic: if no overlapping supported range exists, execution/build fails with a hard error.
4. Compatibility violations are never warnings on autonomous paths.

### Compiler vs Runtime Validation Boundary
Compiler validation responsibilities (pre-execution):
1. Validate schema/version integrity for emitted contracts (`SemanticIR`, emitted metadata, and capability requirements).
2. Enforce static constraints from `PolicyProfile` and `VerificationContract` that are decidable without execution.
3. Reject builds that require capabilities absent from target `CapabilityManifest`.

Runtime validation responsibilities (execution-time authority):
1. Validate incoming contract versions and schema compatibility before plan execution.
2. Enforce `PolicyProfile` gates at capability invocation boundaries.
3. Enforce `VerificationContract` continuation rules; failed required checks are hard-stops.
4. Validate and normalize emitted `FeedbackTensor` and trace payload boundaries.

Shared guardrail:
- Duplicate validation is allowed for fail-fast behavior, but runtime remains final authority for execution safety decisions.

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
