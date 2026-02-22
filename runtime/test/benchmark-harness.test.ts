import assert from "node:assert/strict";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface BenchmarkArtifactRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

interface BenchmarkTaskResult {
  task_id: string;
  baseline_tokens: number;
  ls_tokens: number;
  efficiency_ratio: number;
  quality_floor: {
    status: "pass" | "fail";
    invalid_gain_reasons: string[];
  };
}

interface BenchmarkReport {
  artifact_type: string;
  schema_version: string;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: BenchmarkArtifactRef[];
  trace: {
    suite_id: string;
    threshold_id: string;
  };
  payload: {
    formula: string;
    tasks: BenchmarkTaskResult[];
    aggregates: {
      task_count: number;
      median_efficiency_ratio: number;
      p90_efficiency_ratio: number;
    };
    quality_floor_summary: {
      status: "pass" | "fail";
      invalid_gain_reasons: string[];
    };
    m2_objective_evaluation: {
      decision: "continue" | "stop";
      reason_code: string;
      efficiency_target_met: boolean;
      quality_floor_preserved: boolean;
      valid_gain: boolean;
      failed_metrics: string[];
    };
  };
}

interface BenchmarkCliOutput {
  ok: boolean;
  report_path: string;
  task_count: number;
  gate_pass: boolean;
  failed_metrics: string[];
  valid_gain: boolean;
}

function runBenchmarkCli(args: string[], cwd: string) {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    stdio: "pipe",
    encoding: "utf8"
  };

  return execFileSync("node", args, options);
}

function nearestRankP90(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(0.9 * sorted.length));
  return sorted[rank - 1];
}

function median(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

test("benchmark harness CLI emits M2 legacy benchmark artifact with median and p90 metrics", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const harnessPath = resolve(repoRoot, "benchmarks/run-harness.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-benchmarks-"));
  const outputPath = resolve(tmpRoot, "legacy-benchmark-report.json");

  try {
    const rawStdout = runBenchmarkCli([harnessPath, "--out", outputPath], repoRoot);
    const cliOutput = JSON.parse(rawStdout) as BenchmarkCliOutput;

    assert.equal(existsSync(outputPath), true);
    assert.equal(cliOutput.ok, true);
    assert.equal(cliOutput.report_path, outputPath);
    assert.equal(cliOutput.task_count >= 1, true);
    assert.equal(cliOutput.gate_pass, true);
    assert.deepEqual(cliOutput.failed_metrics, []);
    assert.equal(cliOutput.valid_gain, true);

    const report = JSON.parse(readFileSync(outputPath, "utf8")) as BenchmarkReport;
    assert.equal(report.artifact_type, "ls.m2.legacy_benchmark_report");
    assert.equal(report.schema_version, "1.0.0");
    assert.equal(typeof report.artifact_id, "string");
    assert.equal(report.artifact_id.startsWith("lbr_"), true);
    assert.equal(typeof report.run_id, "string");
    assert.equal(report.run_id.startsWith("run_m2_bench_"), true);
    assert.equal(report.produced_at_utc, "2026-02-22T00:00:00.000Z");
    assert.equal(report.tool_version, "l-semantica@0.1.0");
    assert.equal(Array.isArray(report.inputs), true);
    assert.equal(report.inputs.length > 0, true);
    assert.equal(report.trace.suite_id, "legacy-continuation.v1");
    assert.equal(report.trace.threshold_id, "m2-legacy-benchmark-gates-v1");
    assert.equal(report.payload.formula, "efficiency_ratio = baseline_tokens / ls_tokens");
    assert.equal(Array.isArray(report.payload.tasks), true);
    assert.equal(report.payload.tasks.length, cliOutput.task_count);
    assert.equal(report.payload.aggregates.task_count, cliOutput.task_count);

    const ratios = report.payload.tasks.map((task) => task.efficiency_ratio);
    assert.equal(report.payload.aggregates.median_efficiency_ratio, median(ratios));
    assert.equal(report.payload.aggregates.p90_efficiency_ratio, nearestRankP90(ratios));
    assert.equal(report.payload.aggregates.median_efficiency_ratio >= 5, true);

    for (const task of report.payload.tasks) {
      assert.equal(task.baseline_tokens > 0, true);
      assert.equal(task.ls_tokens > 0, true);
      assert.equal(task.efficiency_ratio, task.baseline_tokens / task.ls_tokens);
      assert.equal(task.quality_floor.status, "pass");
      assert.deepEqual(task.quality_floor.invalid_gain_reasons, []);
    }

    assert.equal(report.payload.quality_floor_summary.status, "pass");
    assert.deepEqual(report.payload.quality_floor_summary.invalid_gain_reasons, []);
    assert.equal(report.payload.m2_objective_evaluation.decision, "continue");
    assert.equal(report.payload.m2_objective_evaluation.reason_code, "ok");
    assert.equal(report.payload.m2_objective_evaluation.efficiency_target_met, true);
    assert.equal(report.payload.m2_objective_evaluation.quality_floor_preserved, true);
    assert.equal(report.payload.m2_objective_evaluation.valid_gain, true);
    assert.deepEqual(report.payload.m2_objective_evaluation.failed_metrics, []);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("benchmark harness CLI fail-closes valid_gain when quality floor regresses despite raw efficiency passing", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const harnessPath = resolve(repoRoot, "benchmarks/run-harness.mjs");
  const tasksPath = resolve(repoRoot, "benchmarks/tasks.json");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-benchmarks-quality-floor-"));
  const configPath = resolve(tmpRoot, "tasks.json");
  const outputPath = resolve(tmpRoot, "legacy-benchmark-report.json");

  try {
    const config = JSON.parse(readFileSync(tasksPath, "utf8")) as {
      tasks: Array<{
        id: string;
        quality_floor: {
          policy_compliant: boolean;
        };
      }>;
    };

    const taskIndex = config.tasks.findIndex(
      (task) => task.id === "legacy-benchmark-gate-quality-floor-enforcement"
    );
    assert.notEqual(taskIndex, -1);
    config.tasks[taskIndex] = {
      ...config.tasks[taskIndex],
      quality_floor: {
        ...config.tasks[taskIndex].quality_floor,
        policy_compliant: false
      }
    };

    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    assert.throws(
      () => runBenchmarkCli([harnessPath, "--config", configPath, "--out", outputPath, "--enforce-thresholds"], repoRoot),
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

        const cliOutput = JSON.parse(stdout) as BenchmarkCliOutput;
        return (
          cliOutput.ok === false &&
          cliOutput.gate_pass === false &&
          cliOutput.valid_gain === false &&
          cliOutput.failed_metrics.includes("quality_floor_preserved") &&
          cliOutput.failed_metrics.includes("valid_gain") &&
          !cliOutput.failed_metrics.includes("median_efficiency_ratio")
        );
      }
    );

    assert.equal(existsSync(outputPath), true);
    const report = JSON.parse(readFileSync(outputPath, "utf8")) as BenchmarkReport;
    assert.equal(report.payload.aggregates.median_efficiency_ratio >= 5, true);
    assert.equal(report.payload.quality_floor_summary.status, "fail");
    assert.equal(
      report.payload.quality_floor_summary.invalid_gain_reasons.includes("policy_violation"),
      true
    );
    assert.equal(report.payload.m2_objective_evaluation.efficiency_target_met, true);
    assert.equal(report.payload.m2_objective_evaluation.quality_floor_preserved, false);
    assert.equal(report.payload.m2_objective_evaluation.valid_gain, false);
    assert.equal(report.payload.m2_objective_evaluation.reason_code, "benchmark_quality_floor_failed");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("benchmark harness artifact output is deterministic across reruns with unchanged inputs", () => {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(testDirectory, "../..");
  const harnessPath = resolve(repoRoot, "benchmarks/run-harness.mjs");
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-benchmarks-deterministic-"));
  const outputPathOne = resolve(tmpRoot, "legacy-benchmark-report-1.json");
  const outputPathTwo = resolve(tmpRoot, "legacy-benchmark-report-2.json");

  try {
    runBenchmarkCli([harnessPath, "--out", outputPathOne], repoRoot);
    runBenchmarkCli([harnessPath, "--out", outputPathTwo], repoRoot);

    const reportOne = readFileSync(outputPathOne, "utf8");
    const reportTwo = readFileSync(outputPathTwo, "utf8");
    assert.equal(reportOne, reportTwo);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
