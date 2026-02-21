# Changelog

All notable changes to this project are documented in this file.

This changelog follows Keep a Changelog style and Semantic Versioning.
Before `1.0.0`, any release (minor or patch) may include breaking changes.

## [Unreleased]
### Added
- No entries yet.

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
