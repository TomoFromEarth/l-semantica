# Changelog

All notable changes to this project are documented in this file.

This changelog follows Keep a Changelog style and Semantic Versioning.
Before `1.0.0`, any release (minor or patch) may include breaking changes.

## [Unreleased]
### Added
- M1 reliability fixture corpus for known failure classes under `benchmarks/fixtures/reliability/failure-corpus.v0.json`, including recoverable and non-recoverable expectations.
- Benchmark reliability corpus loader/validator module (`benchmarks/reliability-corpus.mjs`) with machine-readable schema and enum checks.
- Runtime CI test coverage for reliability corpus loadability and class/recoverability coverage guarantees (`runtime/test/reliability-corpus.test.ts`).
- FeedbackTensor v1 contract draft schema and spec documentation (`docs/spec/schemas/feedbacktensor-v1.schema.json`, `docs/spec/feedbacktensor-v1.md`).
- FeedbackTensor valid/invalid fixture corpus for schema conformance coverage (`docs/spec/examples/feedbacktensor/`).
- Runtime schema validation tests for FeedbackTensor fixtures with actionable error assertions (`runtime/test/feedbacktensor-schema.test.ts`).
- VerificationContract v1 contract draft schema and spec documentation (`docs/spec/schemas/verificationcontract-v1.schema.json`, `docs/spec/verificationcontract-v1.md`).
- VerificationContract valid/invalid fixture corpus and runtime schema validation tests (`docs/spec/examples/verificationcontract/`, `runtime/test/verificationcontract-schema.test.ts`).
- Runtime contract loader support for VerificationContract v1 validation and compatibility checks (`runtime/src/contracts.ts`, `runtime/test/contract-loader.test.ts`).
- Runtime rule-first repair loop with deterministic rule ordering, bounded retries, and explicit `repaired`/`escalate`/`stop` outcomes (`runtime/src/repair-loop.ts`, `runtime/test/repair-loop.test.ts`).
- Reliability corpus assertions that map fixture expectations to repair-loop continuation outcomes (`runtime/test/reliability-corpus.test.ts`).
- Runtime FeedbackTensor emission for failed runtime invocations and terminal repair outcomes with run-id linkage to trace records (`runtime/src/index.ts`, `runtime/src/repair-loop.ts`, `runtime/src/feedback-tensor.ts`, `runtime/test/feedbacktensor-emission.test.ts`).
- Runtime policy + verification continuation gate with explicit reason-coded `continue`/`escalate`/`stop` decisions and blocking semantics on failing/incomplete verification evidence (`runtime/src/continuation-gate.ts`, `runtime/src/index.ts`, `runtime/test/continuation-gate.test.ts`).
- Optional reliability fixture confidence expectations (`expected.expected_confidence`) plus validator support and confidence-emission assertions (`benchmarks/fixtures/reliability/failure-corpus.v0.json`, `benchmarks/reliability-corpus.mjs`, `runtime/test/reliability-corpus.test.ts`).
- Calibration benchmark CLI and report artifact generation for expected-vs-observed confidence checks (`benchmarks/run-calibration.mjs`, `benchmarks/reports/calibration-report.json`, `runtime/test/calibration-report-cli.test.ts`).

### Changed
- FeedbackTensor confidence semantics are now explicitly documented for runtime schema/non-schema failures and repair terminal outcomes, with targeted runtime emission test coverage (`docs/spec/feedbacktensor-v1.md`, `runtime/README.md`, `runtime/test/feedbacktensor-emission.test.ts`).

## [0.1.0] - 2026-02-21
### Added
- M0 minimal `.ls` language surface (`goal`, `capability`, `check`) with grammar documentation and example fixtures.
- Compiler lexer/parser execution path with AST and diagnostics primitives, including parser and lexer test coverage.
- Runtime contract loading and validation for SemanticIR and PolicyProfile schemas with explicit version-compatibility failures.
- Runtime trace ledger v0 emission path with schema/docs/tests for auditable invocation records.
- First executable `.ls` flow in `examples/` with reproducible run steps and CI-enforced smoke checks.
- Benchmark harness stub with structured report output (`baseline_tokens`, `ls_tokens`, `efficiency_ratio`) and starter fixtures.

### Changed
- RFC governance language: acceptance criteria, decision gates, and Phase 0 deliverable mapping were made explicit.
- RFC stable public contract boundaries, compatibility semantics, and compiler/runtime validation split were clarified.

### Project Snapshot
- Milestone: M0 complete.
- Open issues: 0.
- Open pull requests: 0.

[Unreleased]: https://github.com/TomoFromEarth/l-semantica/compare/7bb5b7da5b6f873dcec16c41841285ce367dc8eb...HEAD
[0.1.0]: https://github.com/TomoFromEarth/l-semantica/commit/7bb5b7da5b6f873dcec16c41841285ce367dc8eb
