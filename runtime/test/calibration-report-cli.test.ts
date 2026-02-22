import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface CalibrationReportResult {
  fixture_id: string;
  expected: {
    score_min: number;
    score_max: number;
    calibration_band: string;
  };
  observed: {
    score: number;
    calibration_band: string;
  };
  pass: boolean;
}

interface CalibrationBucketSummary {
  calibration_band: string;
  evaluated_count: number;
  pass_count: number;
  fail_count: number;
}

interface CalibrationReport {
  schema_version: string;
  generated_at: string;
  corpus_id: string;
  fixture_count: number;
  evaluated_fixture_count: number;
  results: CalibrationReportResult[];
  bucket_summary: CalibrationBucketSummary[];
}

interface CalibrationCliOutput {
  ok: boolean;
  report_path: string;
  fixture_count: number;
  evaluated_fixture_count: number;
}

test("calibration CLI emits deterministic report fields and evaluated confidence results", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const calibrationCliPath = resolve(repoRoot, "benchmarks/run-calibration.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-calibration-cli-"));
  const outputPath = resolve(tmpRoot, "calibration-report.json");

  try {
    const rawStdout = execFileSync(
      "node",
      ["--experimental-strip-types", calibrationCliPath, "--out", outputPath],
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8"
      }
    );
    const cliOutput = JSON.parse(rawStdout) as CalibrationCliOutput;

    assert.equal(existsSync(outputPath), true);
    assert.equal(cliOutput.ok, true);
    assert.equal(cliOutput.report_path, outputPath);
    assert.equal(cliOutput.evaluated_fixture_count >= 1, true);

    const report = JSON.parse(readFileSync(outputPath, "utf8")) as CalibrationReport;
    assert.equal(report.schema_version, "0.1.0");
    assert.equal(typeof report.generated_at, "string");
    assert.equal(report.generated_at.length > 0, true);
    assert.equal(typeof report.corpus_id, "string");
    assert.equal(report.corpus_id.length > 0, true);
    assert.equal(report.fixture_count, cliOutput.fixture_count);
    assert.equal(report.evaluated_fixture_count, cliOutput.evaluated_fixture_count);
    assert.equal(report.fixture_count >= report.evaluated_fixture_count, true);
    assert.equal(Array.isArray(report.results), true);
    assert.equal(report.results.length, report.evaluated_fixture_count);

    const firstResult = report.results[0];
    assert.equal(typeof firstResult.fixture_id, "string");
    assert.equal(firstResult.fixture_id.length > 0, true);
    assert.equal(typeof firstResult.expected.score_min, "number");
    assert.equal(typeof firstResult.expected.score_max, "number");
    assert.equal(typeof firstResult.expected.calibration_band, "string");
    assert.equal(typeof firstResult.observed.score, "number");
    assert.equal(typeof firstResult.observed.calibration_band, "string");
    assert.equal(typeof firstResult.pass, "boolean");

    assert.equal(Array.isArray(report.bucket_summary), true);
    assert.equal(report.bucket_summary.length, 3);
    const summarizedEvaluatedCount = report.bucket_summary.reduce(
      (sum, bucket) => sum + bucket.evaluated_count,
      0
    );
    assert.equal(summarizedEvaluatedCount, report.evaluated_fixture_count);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("calibration CLI trims whitespace around --out path values", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const calibrationCliPath = resolve(repoRoot, "benchmarks/run-calibration.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-calibration-cli-"));
  const outputPath = resolve(tmpRoot, "trimmed-calibration-report.json");
  const paddedOutputPath = `  ${outputPath}  `;

  try {
    const rawStdout = execFileSync(
      "node",
      ["--experimental-strip-types", calibrationCliPath, "--out", paddedOutputPath],
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8"
      }
    );
    const cliOutput = JSON.parse(rawStdout) as CalibrationCliOutput;

    assert.equal(cliOutput.ok, true);
    assert.equal(cliOutput.report_path, outputPath);
    assert.equal(existsSync(outputPath), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
