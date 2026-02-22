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

## M1 Calibration Report (`#31`)

Run from repository root:

```bash
pnpm bench:calibration
```

Optional flags:

```bash
node --experimental-strip-types benchmarks/run-calibration.mjs --config benchmarks/fixtures/reliability/failure-corpus.v0.json --out benchmarks/reports/calibration-report.json
```

Flag path behavior:
- explicit `--config` and `--out` values are resolved from the current working directory.
- when omitted, defaults are resolved from the benchmarks directory.

Defaults:
- corpus path: `benchmarks/fixtures/reliability/failure-corpus.v0.json`
- report output path: `benchmarks/reports/calibration-report.json`

Evaluation behavior:
- only fixtures with `expected.expected_confidence` are evaluated.
- each evaluated fixture is run through `runRuleFirstRepairLoop(...)` with FeedbackTensor emission enabled.
- observed confidence is read from the emitted FeedbackTensor entry.

Report fields:
- `schema_version`
- `generated_at`
- `corpus_id`
- `fixture_count`
- `evaluated_fixture_count`
- `results[]` (fixture-level expected vs observed confidence and `pass`)
- `bucket_summary[]` (per calibration band `evaluated_count`, `pass_count`, `fail_count`)
- `aggregate.pass_count`
- `aggregate.fail_count`

## M1 Reliability Benchmark Gates (`#35`)

Run from repository root:

```bash
pnpm bench:reliability
```

Threshold-enforced run (used in CI):

```bash
pnpm bench:reliability -- --enforce-thresholds
```

Optional flags:

```bash
node --experimental-strip-types benchmarks/run-reliability-gates.mjs \
  --config benchmarks/fixtures/reliability/failure-corpus.v0.json \
  --thresholds benchmarks/reliability-gates-thresholds.v1.json \
  --out benchmarks/reports/reliability-gates-report.json \
  --enforce-thresholds
```

Flag path behavior:
- explicit `--config`, `--thresholds`, and `--out` values are resolved from the current working directory.
- when omitted, defaults are resolved from the benchmarks directory.

Defaults:
- corpus path: `benchmarks/fixtures/reliability/failure-corpus.v0.json`
- threshold config path: `benchmarks/reliability-gates-thresholds.v1.json`
- report output path: `benchmarks/reports/reliability-gates-report.json`

Threshold config fields:
- `schema_version`
- `threshold_id`
- `corpus_schema_version`
- `metrics.recovery_rate`
- `metrics.safe_block_rate`
- `metrics.safe_allow_rate`

Gate metrics:
- `recovery_rate`: `recovered_fixture_count / recoverable_fixture_count`
- `safe_block_rate`: `blocked_unsafe_continuation_count / non_recoverable_fixture_count`
- `safe_allow_rate`: `allowed_compliant_continuation_count / recoverable_fixture_count`

Report fields:
- `schema_version`
- `generated_at`
- `corpus_id`
- `corpus_schema_version`
- `thresholds`
- `fixture_count`
- `results[]` (fixture-level expected vs observed classification/continuation/decision checks)
- `aggregate.recovery`
- `aggregate.safe_continuation`
- `aggregate.classification`
- `aggregate.gates` (`pass` + `failed_metrics[]`)
- `by_failure_class[]` (per failure-class counts and rates)
