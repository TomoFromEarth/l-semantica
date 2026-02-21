# Benchmarks

Token-efficiency, reliability, and parity benchmark suites.

## M0 Harness Stub (`#13`)

Run from repository root:

```bash
pnpm bench:run
```

Optional flags:

```bash
node benchmarks/run-harness.mjs --config tasks.json --out reports/token-efficiency-report.json
```

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
