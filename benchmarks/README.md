# Benchmarks

Token-efficiency, reliability, and parity benchmark suites.

## M0 Harness Stub (`#13`)

Run from repository root:

```bash
pnpm bench:run
```

Optional flags:

```bash
node benchmarks/run-harness.mjs --config benchmarks/tasks.json --out benchmarks/reports/token-efficiency-report.json
```

Flag path behavior:
- explicit `--config` and `--out` values are resolved from the current working directory.
- when omitted, defaults are resolved from the harness directory (`benchmarks/`).

Defaults:
- task list: `benchmarks/tasks.json`
- report output path: `benchmarks/reports/token-efficiency-report.json`

Report fields:
- `baseline_tokens`
- `ls_tokens`
- `efficiency_ratio`

Formula:
- `efficiency_ratio = baseline_tokens / ls_tokens`

Included fixtures:
- baseline prompt: `benchmarks/fixtures/baseline/grounded-response-minimal.txt`
- `.ls` fixture: `benchmarks/fixtures/ls/grounded-response-minimal.ls`

## M1 Reliability Fixture Corpus (`#27`)

Corpus location:
- `benchmarks/fixtures/reliability/failure-corpus.v0.json`

Loader/validator module:
- `benchmarks/reliability-corpus.mjs`

Top-level corpus fields:
- `schema_version`
- `corpus_id`
- `description`
- `fixtures[]`

Required fixture fields:
- `id` (unique string)
- `failure_class` (`parse`, `schema_contract`, `policy_gate`, `capability_denied`, `deterministic_runtime`, `stochastic_extraction_uncertainty`)
- `scenario`
- `recoverability` (`recoverable` or `non_recoverable`)
- `expected.classification`
- `expected.continuation_allowed`
- `input.stage`
- `input.artifact`
- `input.excerpt`

Update workflow:
1. Add or edit fixtures in `benchmarks/fixtures/reliability/failure-corpus.v0.json`.
2. Keep at least one `recoverable` and one `non_recoverable` fixture per `failure_class`.
3. Run `pnpm test` to validate loader and coverage checks via `runtime/test/reliability-corpus.test.ts`.
