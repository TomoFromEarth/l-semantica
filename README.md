# L-Semantica

Model-first, human-inspectable language and compiler for reliable, policy-governed LLM agent execution.

## Status
Pre-alpha. Interfaces and implementation are evolving quickly.

## Why
L-Semantica is designed to make agent systems:
- more reliable under autonomous execution
- more auditable and replayable
- more token-efficient on real software tasks

## Core Principles
- Deterministic core, explicit stochastic edges
- First-class goals, constraints, and verification
- Policy-gated autonomy
- Framework-agnostic semantics and multi-target output
- Human-owned generated artifacts

## Planned Layout
- `/compiler` parser, type/effect checks, IR lowering
- `/runtime` execution engine, policy gates, replay
- `/stdlib` reusable language/runtime primitives
- `/adapters` target adapters (server/web/mobile/desktop)
- `/examples` minimal end-to-end programs
- `/benchmarks` token-efficiency and reliability suites
- `/rfcs` architecture and language evolution
- `/docs` user and contributor documentation

## Getting Started
Bootstrap documents are in place; compiler/runtime code is next.

See:
- `rfcs/README.md`
- `CONTRIBUTING.md`
- `GOVERNANCE.md`

## License
Apache-2.0 (`LICENSE`).
