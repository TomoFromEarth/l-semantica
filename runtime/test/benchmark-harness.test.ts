import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface BenchmarkTaskResult {
  baseline_tokens: number;
  ls_tokens: number;
  efficiency_ratio: number;
}

interface BenchmarkReport {
  schema_version: string;
  report_path: string;
  formula: string;
  results: BenchmarkTaskResult[];
}

test("benchmark harness CLI emits structured report with encoded ratio formula", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const harnessPath = resolve(repoRoot, "benchmarks/run-harness.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-benchmarks-"));
  const outputPath = resolve(tmpRoot, "token-efficiency-report.json");

  try {
    execFileSync("node", [harnessPath, "--out", outputPath], {
      cwd: repoRoot,
      stdio: "pipe"
    });

    assert.equal(existsSync(outputPath), true);

    const report = JSON.parse(readFileSync(outputPath, "utf8")) as BenchmarkReport;
    assert.equal(report.schema_version, "0.1.0");
    assert.equal(report.report_path, outputPath);
    assert.equal(report.formula, "efficiency_ratio = baseline_tokens / ls_tokens");
    assert.equal(Array.isArray(report.results), true);
    assert.equal(report.results.length >= 1, true);

    const firstResult = report.results[0];
    assert.equal(firstResult.baseline_tokens > 0, true);
    assert.equal(firstResult.ls_tokens > 0, true);
    assert.equal(firstResult.efficiency_ratio, firstResult.baseline_tokens / firstResult.ls_tokens);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
