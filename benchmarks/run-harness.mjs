import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_SCHEMA_VERSION = "0.1.0";
const EFFICIENCY_RATIO_FORMULA = "efficiency_ratio = baseline_tokens / ls_tokens";

function toTokenCount(text) {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.split(/\s+/u).length;
}

function parseJsonFile(path) {
  const source = readFileSync(path, "utf8");
  return JSON.parse(source);
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--config") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --config");
      }
      options.configPath = value;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      options.outputPath = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node benchmarks/run-harness.mjs [--config <path>] [--out <path>]");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireTaskList(config) {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Benchmark config must be an object");
  }

  const tasks = config.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("Benchmark config must include at least one task");
  }

  return tasks;
}

function requireTaskField(task, fieldName) {
  const value = task?.[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Task field ${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function runTask(task, projectRoot) {
  const id = requireTaskField(task, "id");
  const name = requireTaskField(task, "name");
  const baselineFixture = requireTaskField(task, "baseline_fixture");
  const lsFixture = requireTaskField(task, "ls_fixture");

  const baselineText = readFileSync(resolve(projectRoot, baselineFixture), "utf8");
  const lsText = readFileSync(resolve(projectRoot, lsFixture), "utf8");

  const baselineTokens = toTokenCount(baselineText);
  const lsTokens = toTokenCount(lsText);

  if (lsTokens === 0) {
    throw new Error(`Task ${id} produced zero ls tokens`);
  }

  return {
    task_id: id,
    task_name: name,
    baseline_fixture: baselineFixture,
    ls_fixture: lsFixture,
    baseline_tokens: baselineTokens,
    ls_tokens: lsTokens,
    efficiency_ratio: baselineTokens / lsTokens
  };
}

function createReport(results, outputPath) {
  const baselineTotal = results.reduce((sum, result) => sum + result.baseline_tokens, 0);
  const lsTotal = results.reduce((sum, result) => sum + result.ls_tokens, 0);

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    formula: EFFICIENCY_RATIO_FORMULA,
    report_path: outputPath,
    results,
    aggregate: {
      task_count: results.length,
      baseline_tokens_total: baselineTotal,
      ls_tokens_total: lsTotal,
      efficiency_ratio_total: lsTotal === 0 ? 0 : baselineTotal / lsTotal
    }
  };
}

function main() {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolve(scriptDirectory, options.configPath ?? "tasks.json");
  const outputPath = resolve(scriptDirectory, options.outputPath ?? "reports/token-efficiency-report.json");

  const config = parseJsonFile(configPath);
  const tasks = requireTaskList(config);
  const results = tasks.map((task) => runTask(task, projectRoot));
  const report = createReport(results, outputPath);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        report_path: outputPath,
        task_count: report.aggregate.task_count
      },
      null,
      2
    )
  );
}

main();
