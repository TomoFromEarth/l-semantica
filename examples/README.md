# Examples

Minimal executable examples demonstrating language and runtime behavior.

## First Executable Flow (`#12`)

Files:
- `first-executable.ls`: source program.
- `first-executable.runtime-input.json`: expected runtime input artifact derived from the `.ls` goal declaration.
- `run-first-executable.mjs`: reproducible parse + execute script.

Run:

```bash
node --experimental-strip-types examples/run-first-executable.mjs
```

Expected output:
- JSON with `ok: true`
- `runtimeInput` matching `first-executable.runtime-input.json`
- `runtimeResult.traceId` equal to `trace-0.1.0`

Smoke enforcement:
- `compiler/test/examples-smoke.test.ts` validates the same flow and is executed by CI through workspace tests (`pnpm -r test`).
