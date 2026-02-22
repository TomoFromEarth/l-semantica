import assert from "node:assert/strict";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface ReliabilityGateCliOutput {
  ok: boolean;
  report_path: string;
  fixture_count: number;
  gate_pass: boolean;
  failed_metrics: string[];
}

interface ReliabilityGateMetricStatus {
  pass: boolean;
}

interface ReliabilityGateReport {
  schema_version: string;
  generated_at: string;
  corpus_id: string;
  fixture_count: number;
  aggregate: {
    recovery: ReliabilityGateMetricStatus;
    safe_continuation: {
      safe_block_rate_pass: boolean;
      safe_allow_rate_pass: boolean;
    };
    gates: {
      pass: boolean;
      failed_metrics: string[];
    };
  };
  by_failure_class: Array<{
    failure_class: string;
  }>;
}

function runReliabilityCli(args: string[], cwd: string) {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    stdio: "pipe",
    encoding: "utf8"
  };

  return execFileSync("node", ["--experimental-strip-types", ...args], options);
}

test("reliability gate CLI emits structured report and passing gate summary", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const cliPath = resolve(repoRoot, "benchmarks/run-reliability-gates.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-reliability-gates-"));
  const outputPath = resolve(tmpRoot, "reliability-gates-report.json");

  try {
    const rawStdout = runReliabilityCli([cliPath, "--out", outputPath], repoRoot);
    const cliOutput = JSON.parse(rawStdout) as ReliabilityGateCliOutput;

    assert.equal(cliOutput.ok, true);
    assert.equal(cliOutput.report_path, outputPath);
    assert.equal(cliOutput.fixture_count > 0, true);
    assert.equal(cliOutput.gate_pass, true);
    assert.deepEqual(cliOutput.failed_metrics, []);
    assert.equal(existsSync(outputPath), true);

    const report = JSON.parse(readFileSync(outputPath, "utf8")) as ReliabilityGateReport;
    assert.equal(report.schema_version, "0.1.0");
    assert.equal(report.generated_at, "2026-02-22T00:00:00.000Z");
    assert.equal(typeof report.corpus_id, "string");
    assert.equal(report.corpus_id.length > 0, true);
    assert.equal(report.fixture_count, cliOutput.fixture_count);
    assert.equal(report.aggregate.recovery.pass, true);
    assert.equal(report.aggregate.safe_continuation.safe_block_rate_pass, true);
    assert.equal(report.aggregate.safe_continuation.safe_allow_rate_pass, true);
    assert.equal(report.aggregate.gates.pass, true);
    assert.deepEqual(report.aggregate.gates.failed_metrics, []);
    assert.equal(Array.isArray(report.by_failure_class), true);
    assert.equal(report.by_failure_class.length, 6);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("reliability gate CLI enforces thresholds and fails with report output on violations", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const cliPath = resolve(repoRoot, "benchmarks/run-reliability-gates.mjs");
  const fixtureCorpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-reliability-gates-fail-"));
  const corpusPath = resolve(tmpRoot, "failure-corpus.v0.json");
  const thresholdsPath = resolve(tmpRoot, "reliability-gates-thresholds.v1.json");
  const outputPath = resolve(tmpRoot, "reliability-gates-report.json");

  try {
    const corpus = JSON.parse(readFileSync(fixtureCorpusPath, "utf8")) as {
      fixtures: Array<{
        id: string;
        failure_class: string;
        scenario: string;
        recoverability: "recoverable" | "non_recoverable";
        expected: {
          classification: string;
          continuation_allowed: boolean;
        };
        input: {
          stage: string;
          artifact: string;
          excerpt: string;
        };
      }>;
    };

    const fixtureIndex = corpus.fixtures.findIndex(
      (fixture) => fixture.id === "parse-missing-goal-quote-recoverable"
    );
    assert.notEqual(fixtureIndex, -1);
    corpus.fixtures[fixtureIndex] = {
      ...corpus.fixtures[fixtureIndex],
      scenario:
        "Mutated for threshold regression test: marked recoverable but input is not deterministically repaired.",
      input: {
        stage: "compile",
        artifact: "ls_source",
        excerpt: "goal Ship release"
      }
    };

    writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
    writeFileSync(
      thresholdsPath,
      `${JSON.stringify(
        {
          schema_version: "1.0.0",
          threshold_id: "test-thresholds",
          corpus_schema_version: "0.1.0",
          metrics: {
            recovery_rate: 1,
            safe_block_rate: 1,
            safe_allow_rate: 1
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    assert.throws(
      () =>
        runReliabilityCli(
          [
            cliPath,
            "--config",
            corpusPath,
            "--thresholds",
            thresholdsPath,
            "--out",
            outputPath,
            "--enforce-thresholds"
          ],
          repoRoot
        ),
      (error) => {
        const commandError = error as NodeJS.ErrnoException & {
          status?: number;
          stdout?: string | Buffer;
        };
        if (commandError.status !== 1) {
          return false;
        }

        const stdout =
          typeof commandError.stdout === "string"
            ? commandError.stdout
            : commandError.stdout?.toString("utf8") ?? "";
        if (stdout.trim().length === 0) {
          return false;
        }

        const cliOutput = JSON.parse(stdout) as ReliabilityGateCliOutput;
        return (
          cliOutput.ok === false &&
          cliOutput.gate_pass === false &&
          cliOutput.failed_metrics.includes("recovery_rate")
        );
      }
    );

    assert.equal(existsSync(outputPath), true);
    const report = JSON.parse(readFileSync(outputPath, "utf8")) as ReliabilityGateReport;
    assert.equal(report.aggregate.gates.pass, false);
    assert.equal(report.aggregate.gates.failed_metrics.includes("recovery_rate"), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
