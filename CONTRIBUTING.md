# Contributing to L-Semantica

## Scope
Contributions are welcome for language design, compiler/runtime implementation, benchmarks, docs, and tooling.

## Workflow
1. Open or discuss an issue before large changes.
2. For design-impacting changes, submit an RFC in `rfcs/` first.
3. Use small, reviewable pull requests.
4. Include tests for behavior changes.

## Branching
- Default branch: `main`
- Feature branches: `feat/<short-name>` or `fix/<short-name>`

## Pull Request Expectations
- Clear problem statement and scope
- Tests added/updated
- Backward-compatibility notes (if applicable)
- Risks and tradeoffs documented

## Commit Guidance
Use clear, imperative commit messages:
- `compiler: add AST node for goal declaration`
- `runtime: enforce capability manifest checks`

## RFC Process
- Place RFCs under `rfcs/` using `rfcs/000-template.md`
- Mark status as `Draft`, `Accepted`, `Rejected`, or `Superseded`
- At least one maintainer approval required before implementation merge

## Code of Conduct
By participating, you agree to the rules in `CODE_OF_CONDUCT.md`.
