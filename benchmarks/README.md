# Benchmarks

Token-efficiency, reliability, and parity benchmark suites.

## M2 Legacy Continuation Benchmark Report and Gates (`#55`)

Run from repository root:

```bash
pnpm bench:run
```

Threshold-enforced run (used for M2 objective gating / CI):

```bash
pnpm bench:run -- --enforce-thresholds
```

Optional flags:

```bash
node benchmarks/run-harness.mjs \
  --config benchmarks/tasks.json \
  --thresholds benchmarks/legacy-benchmark-gates-thresholds.v1.json \
  --out benchmarks/reports/legacy-benchmark-report.json \
  --enforce-thresholds
```

Flag path behavior:
- explicit `--config`, `--thresholds`, and `--out` values are resolved from the current working directory.
- when omitted, defaults are resolved from the harness directory (`benchmarks/`).

Defaults:
- task list: `benchmarks/tasks.json`
- threshold config: `benchmarks/legacy-benchmark-gates-thresholds.v1.json`
- report output path: `benchmarks/reports/legacy-benchmark-report.json`

Task config (`benchmarks/tasks.json`) fields:
- `schema_version` (`1.0.0`)
- `suite_id`
- `tasks[]`
- `tasks[].id`, `tasks[].name`
- `tasks[].baseline_fixture`, `tasks[].ls_fixture`
- `tasks[].inputs[]` (`artifact_id`, `artifact_type`, `schema_version`)
- `tasks[].quality_floor.required_checks.{required,completed,failed}`
- `tasks[].quality_floor.policy_compliant`
- `tasks[].quality_floor.acceptance_criteria_met`
- `tasks[].quality_floor.traceability_complete`
- `tasks[].quality_floor.unsupported_bypass`
- `tasks[].quality_floor.artifact_contract_valid`

Threshold config (`benchmarks/legacy-benchmark-gates-thresholds.v1.json`) fields:
- `schema_version`
- `threshold_id`
- `artifact_schema_version`
- `metrics.median_efficiency_ratio_min`
- `requirements.quality_floor_preserved`
- `requirements.valid_gain`

Report artifact envelope fields:
- `artifact_type` (`ls.m2.legacy_benchmark_report`)
- `schema_version` (`1.0.0`)
- `artifact_id`
- `run_id`
- `produced_at_utc` (deterministic for reproducible diffs)
- `tool_version`
- `inputs[]`
- `trace.suite_id`
- `trace.threshold_id`

Report payload fields:
- `formula`
- `tasks[]` (per-task `efficiency_ratio`, token counts, `quality_floor.status`, `quality_floor.invalid_gain_reasons`)
- `aggregates.median_efficiency_ratio`
- `aggregates.p90_efficiency_ratio` (nearest-rank p90)
- `quality_floor_summary.status`
- `quality_floor_summary.invalid_gain_reasons`
- `m2_objective_evaluation.{efficiency_target_met,quality_floor_preserved,valid_gain}`
- `m2_objective_evaluation.failed_metrics`

Gate behavior:
- per-task `efficiency_ratio = baseline_tokens / ls_tokens`
- report marks invalid gains with machine-readable `invalid_gain_reasons`
- aggregate M2 gate requires `median_efficiency_ratio >= 5.0` and preserved quality floor (`valid_gain = true`)
- `--enforce-thresholds` writes the report and exits non-zero when the gate fails

Included fixtures:
- `benchmarks/fixtures/baseline/legacy-runtime-pr-bundle-hardening.txt`
- `benchmarks/fixtures/baseline/legacy-benchmark-gate-quality-floor-enforcement.txt`
- `benchmarks/fixtures/baseline/legacy-ci-benchmark-wiring-minimal-scope.txt`
- matching `.ls` fixtures under `benchmarks/fixtures/ls/`

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

Coverage enforcement:
- gate evaluation requires at least one `recoverable` and one `non_recoverable` fixture for each failure class.
- missing per-class recoverability coverage fails the reliability gate command before report generation.

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
