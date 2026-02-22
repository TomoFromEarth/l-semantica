import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TASK_CONFIG_SCHEMA_VERSION = "1.0.0";
const REPORT_ARTIFACT_TYPE = "ls.m2.legacy_benchmark_report";
const REPORT_SCHEMA_VERSION = "1.0.0";
const THRESHOLD_SCHEMA_VERSION = "1.0.0";
const DETERMINISTIC_PRODUCED_AT_UTC = "2026-02-22T00:00:00.000Z";
const DEFAULT_SUITE_ID = "legacy-continuation.v1";
const DEFAULT_THRESHOLDS_RELATIVE_PATH = "legacy-benchmark-gates-thresholds.v1.json";
const DEFAULT_REPORT_RELATIVE_PATH = "reports/legacy-benchmark-report.json";
const EFFICIENCY_RATIO_FORMULA = "efficiency_ratio = baseline_tokens / ls_tokens";
const INVALID_GAIN_REASON_ORDER = [
  "required_checks_failed",
  "required_checks_incomplete",
  "policy_violation",
  "acceptance_criteria_failed",
  "traceability_incomplete",
  "unsupported_bypass",
  "artifact_contract_invalid"
];
const VALID_INVALID_GAIN_REASONS = new Set(INVALID_GAIN_REASON_ORDER);

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
  const normalizedArgv = [...argv];
  if (normalizedArgv[0] === "--") {
    normalizedArgv.shift();
  }

  const options = {};

  function readOptionValue(flagName, valueCandidate) {
    if (!valueCandidate || valueCandidate === "--" || valueCandidate.startsWith("-")) {
      throw new Error(`Missing value for ${flagName}`);
    }

    return valueCandidate;
  }

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];

    if (arg === "--") {
      break;
    }

    if (arg === "--config") {
      options.configPath = readOptionValue("--config", normalizedArgv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--thresholds") {
      options.thresholdsPath = readOptionValue("--thresholds", normalizedArgv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.outputPath = readOptionValue("--out", normalizedArgv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--enforce-thresholds") {
      options.enforceThresholds = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node benchmarks/run-harness.mjs [--config <path>] [--thresholds <path>] [--out <path>] [--enforce-thresholds]"
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    enforceThresholds: false,
    ...options
  };
}

function assertObject(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Benchmark config field ${path} must be an object`);
  }

  return value;
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Benchmark config field ${path} must be a non-empty string`);
  }

  return value.trim();
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new Error(`Benchmark config field ${path} must be a boolean`);
  }

  return value;
}

function assertFiniteNumber(value, path) {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    throw new Error(`Benchmark config field ${path} must be a finite number`);
  }

  return value;
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Benchmark config field ${path} must be a non-negative integer`);
  }

  return value;
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Benchmark config field ${path} must be a positive integer`);
  }

  return value;
}

function compareStringsCodePoint(a, b) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

function compareArtifactRefs(left, right) {
  const typeOrder = compareStringsCodePoint(left.artifact_type, right.artifact_type);
  if (typeOrder !== 0) {
    return typeOrder;
  }

  const idOrder = compareStringsCodePoint(left.artifact_id, right.artifact_id);
  if (idOrder !== 0) {
    return idOrder;
  }

  return compareStringsCodePoint(left.schema_version, right.schema_version);
}

function normalizeArtifactRef(candidate, path) {
  const value = assertObject(candidate, path);
  const artifactId = assertNonEmptyString(value.artifact_id, `${path}.artifact_id`);
  const artifactType = assertNonEmptyString(value.artifact_type, `${path}.artifact_type`);
  const schemaVersion = assertNonEmptyString(value.schema_version, `${path}.schema_version`);

  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    schema_version: schemaVersion
  };
}

function normalizeArtifactRefList(candidate, path, { minLength = 0 } = {}) {
  if (!Array.isArray(candidate)) {
    throw new Error(`Benchmark config field ${path} must be an array`);
  }

  if (candidate.length < minLength) {
    const minimumMessage = minLength === 1 ? "at least 1 entry" : `at least ${minLength} entries`;
    throw new Error(`Benchmark config field ${path} must contain ${minimumMessage}`);
  }

  const deduped = new Map();
  for (let index = 0; index < candidate.length; index += 1) {
    const ref = normalizeArtifactRef(candidate[index], `${path}[${index}]`);
    const dedupeKey = `${ref.artifact_type}\u0000${ref.artifact_id}\u0000${ref.schema_version}`;
    deduped.set(dedupeKey, ref);
  }

  return [...deduped.values()].sort(compareArtifactRefs);
}

function normalizeQualityFloorConfig(candidate, path) {
  const value = assertObject(candidate, path);
  const requiredChecks = assertObject(value.required_checks, `${path}.required_checks`);
  const requiredCheckCount = assertPositiveInteger(
    requiredChecks.required,
    `${path}.required_checks.required`
  );
  const completedCheckCount = assertNonNegativeInteger(
    requiredChecks.completed,
    `${path}.required_checks.completed`
  );
  const failedCheckCount = assertNonNegativeInteger(
    requiredChecks.failed,
    `${path}.required_checks.failed`
  );
  if (completedCheckCount > requiredCheckCount) {
    throw new Error(
      `Benchmark config field ${path}.required_checks.completed cannot exceed required`
    );
  }
  if (failedCheckCount > completedCheckCount) {
    throw new Error(`Benchmark config field ${path}.required_checks.failed cannot exceed completed`);
  }

  return {
    required_checks: {
      required: requiredCheckCount,
      completed: completedCheckCount,
      failed: failedCheckCount
    },
    policy_compliant: assertBoolean(value.policy_compliant, `${path}.policy_compliant`),
    acceptance_criteria_met: assertBoolean(
      value.acceptance_criteria_met,
      `${path}.acceptance_criteria_met`
    ),
    traceability_complete: assertBoolean(value.traceability_complete, `${path}.traceability_complete`),
    unsupported_bypass: assertBoolean(value.unsupported_bypass, `${path}.unsupported_bypass`),
    artifact_contract_valid: assertBoolean(
      value.artifact_contract_valid,
      `${path}.artifact_contract_valid`
    )
  };
}

function evaluateQualityFloor(qualityFloorConfig) {
  const invalidGainReasons = [];
  if (qualityFloorConfig.required_checks.failed > 0) {
    invalidGainReasons.push("required_checks_failed");
  }
  if (qualityFloorConfig.required_checks.completed < qualityFloorConfig.required_checks.required) {
    invalidGainReasons.push("required_checks_incomplete");
  }
  if (!qualityFloorConfig.policy_compliant) {
    invalidGainReasons.push("policy_violation");
  }
  if (!qualityFloorConfig.acceptance_criteria_met) {
    invalidGainReasons.push("acceptance_criteria_failed");
  }
  if (!qualityFloorConfig.traceability_complete) {
    invalidGainReasons.push("traceability_incomplete");
  }
  if (qualityFloorConfig.unsupported_bypass) {
    invalidGainReasons.push("unsupported_bypass");
  }
  if (!qualityFloorConfig.artifact_contract_valid) {
    invalidGainReasons.push("artifact_contract_invalid");
  }

  return {
    status: invalidGainReasons.length === 0 ? "pass" : "fail",
    invalid_gain_reasons: invalidGainReasons
  };
}

function normalizeTaskConfig(task, index) {
  const path = `tasks[${index}]`;
  const value = assertObject(task, path);
  const id = assertNonEmptyString(value.id, `${path}.id`);
  const name = assertNonEmptyString(value.name, `${path}.name`);
  const baselineFixture = assertNonEmptyString(value.baseline_fixture, `${path}.baseline_fixture`);
  const lsFixture = assertNonEmptyString(value.ls_fixture, `${path}.ls_fixture`);
  const inputs = normalizeArtifactRefList(value.inputs, `${path}.inputs`, { minLength: 1 });
  const qualityFloor = normalizeQualityFloorConfig(value.quality_floor, `${path}.quality_floor`);

  return {
    id,
    name,
    baseline_fixture: baselineFixture,
    ls_fixture: lsFixture,
    inputs,
    quality_floor: qualityFloor
  };
}

function normalizeTaskConfigFile(candidate) {
  const config = assertObject(candidate, "config");
  const schemaVersion = assertNonEmptyString(config.schema_version, "schema_version");
  if (schemaVersion !== TASK_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Benchmark config schema_version "${schemaVersion}" is incompatible; expected "${TASK_CONFIG_SCHEMA_VERSION}"`
    );
  }

  const suiteId =
    typeof config.suite_id === "string" && config.suite_id.trim().length > 0
      ? config.suite_id.trim()
      : DEFAULT_SUITE_ID;

  const tasksRaw = config.tasks;
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
    throw new Error("Benchmark config must include at least one task");
  }

  const tasks = tasksRaw.map((task, index) => normalizeTaskConfig(task, index));
  const seenTaskIds = new Set();
  for (const task of tasks) {
    if (seenTaskIds.has(task.id)) {
      throw new Error(`Benchmark config task id "${task.id}" must be unique`);
    }
    seenTaskIds.add(task.id);
  }

  const topLevelInputs =
    config.inputs === undefined ? [] : normalizeArtifactRefList(config.inputs, "inputs");

  return {
    schema_version: schemaVersion,
    suite_id: suiteId,
    tasks: tasks
      .slice()
      .sort(
        (left, right) =>
          compareStringsCodePoint(left.id, right.id) || compareStringsCodePoint(left.name, right.name)
      ),
    inputs: topLevelInputs
  };
}

function normalizeThresholdConfig(candidate) {
  const config = assertObject(candidate, "thresholds");
  const schemaVersion = assertNonEmptyString(config.schema_version, "thresholds.schema_version");
  if (schemaVersion !== THRESHOLD_SCHEMA_VERSION) {
    throw new Error(
      `Benchmark thresholds schema_version "${schemaVersion}" is incompatible; expected "${THRESHOLD_SCHEMA_VERSION}"`
    );
  }

  const thresholdId = assertNonEmptyString(config.threshold_id, "thresholds.threshold_id");
  const artifactSchemaVersion = assertNonEmptyString(
    config.artifact_schema_version,
    "thresholds.artifact_schema_version"
  );
  if (artifactSchemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Benchmark thresholds artifact_schema_version "${artifactSchemaVersion}" is incompatible; expected "${REPORT_SCHEMA_VERSION}"`
    );
  }

  const metrics = assertObject(config.metrics, "thresholds.metrics");
  const requirements = assertObject(config.requirements, "thresholds.requirements");

  return {
    schema_version: schemaVersion,
    threshold_id: thresholdId,
    artifact_schema_version: artifactSchemaVersion,
    metrics: {
      median_efficiency_ratio_min: assertFiniteNumber(
        metrics.median_efficiency_ratio_min,
        "thresholds.metrics.median_efficiency_ratio_min"
      )
    },
    requirements: {
      quality_floor_preserved: assertBoolean(
        requirements.quality_floor_preserved,
        "thresholds.requirements.quality_floor_preserved"
      ),
      valid_gain: assertBoolean(requirements.valid_gain, "thresholds.requirements.valid_gain")
    }
  };
}

function resolveCliPath(pathOrUndefined, defaultRelativePath, scriptDirectory) {
  if (typeof pathOrUndefined !== "string" || pathOrUndefined.trim().length === 0) {
    return resolve(scriptDirectory, defaultRelativePath);
  }

  return resolve(process.cwd(), pathOrUndefined.trim());
}

function runTask(task, projectRoot) {
  const baselineText = readFileSync(resolve(projectRoot, task.baseline_fixture), "utf8");
  const lsText = readFileSync(resolve(projectRoot, task.ls_fixture), "utf8");

  const baselineTokens = toTokenCount(baselineText);
  const lsTokens = toTokenCount(lsText);

  if (lsTokens === 0) {
    throw new Error(`Task ${task.id} produced zero ls tokens`);
  }

  const efficiencyRatio = baselineTokens / lsTokens;
  const qualityFloor = evaluateQualityFloor(task.quality_floor);
  const validGain = qualityFloor.status === "pass";

  return {
    task_id: task.id,
    task_name: task.name,
    baseline_fixture: task.baseline_fixture,
    ls_fixture: task.ls_fixture,
    inputs: task.inputs,
    baseline_tokens: baselineTokens,
    ls_tokens: lsTokens,
    efficiency_ratio: efficiencyRatio,
    quality_floor: {
      ...qualityFloor,
      required_checks: { ...task.quality_floor.required_checks },
      evidence: {
        policy_compliant: task.quality_floor.policy_compliant,
        acceptance_criteria_met: task.quality_floor.acceptance_criteria_met,
        traceability_complete: task.quality_floor.traceability_complete,
        unsupported_bypass: task.quality_floor.unsupported_bypass,
        artifact_contract_valid: task.quality_floor.artifact_contract_valid
      }
    },
    gain_valid: validGain
  };
}

function safeDivide(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function createSortedNumberList(values) {
  return values.slice().sort((left, right) => left - right);
}

function median(values) {
  const sorted = createSortedNumberList(values);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function percentileNearestRank(values, percentile) {
  const sorted = createSortedNumberList(values);
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[rank - 1];
}

function orderedUniqueInvalidGainReasons(reasonLists) {
  const seen = new Set();
  for (const reasons of reasonLists) {
    for (const reason of reasons) {
      if (!VALID_INVALID_GAIN_REASONS.has(reason)) {
        throw new Error(`Unsupported invalid_gain_reason "${reason}"`);
      }
      seen.add(reason);
    }
  }

  return INVALID_GAIN_REASON_ORDER.filter((reason) => seen.has(reason));
}

function createAggregateQualityFloorSummary(results) {
  const invalidGainReasons = orderedUniqueInvalidGainReasons(
    results.map((result) => result.quality_floor.invalid_gain_reasons)
  );
  return {
    status: invalidGainReasons.length === 0 ? "pass" : "fail",
    invalid_gain_reasons: invalidGainReasons
  };
}

function createGateEvaluation({ medianEfficiencyRatio, qualityFloorSummary, thresholds }) {
  const efficiencyTargetMet =
    medianEfficiencyRatio >= thresholds.metrics.median_efficiency_ratio_min;
  const qualityFloorPreserved = qualityFloorSummary.status === "pass";
  const validGain = efficiencyTargetMet && qualityFloorPreserved;

  const failedMetrics = [];
  if (!efficiencyTargetMet) {
    failedMetrics.push("median_efficiency_ratio");
  }
  if (thresholds.requirements.quality_floor_preserved && !qualityFloorPreserved) {
    failedMetrics.push("quality_floor_preserved");
  }
  if (thresholds.requirements.valid_gain && !validGain) {
    failedMetrics.push("valid_gain");
  }

  let reasonCode = "ok";
  let reasonDetail = `Median efficiency ratio meets threshold (${thresholds.metrics.median_efficiency_ratio_min}) and quality floor is preserved`;
  if (!qualityFloorPreserved) {
    reasonCode = "benchmark_quality_floor_failed";
    reasonDetail = "One or more benchmark tasks failed quality-floor requirements";
  } else if (!efficiencyTargetMet) {
    reasonCode = "benchmark_invalid_gain";
    reasonDetail = `Median efficiency ratio ${medianEfficiencyRatio} is below required threshold ${thresholds.metrics.median_efficiency_ratio_min}`;
  }

  return {
    decision: validGain ? "continue" : "stop",
    reason_code: reasonCode,
    reason_detail: reasonDetail,
    efficiency_target_met: efficiencyTargetMet,
    quality_floor_preserved: qualityFloorPreserved,
    valid_gain: validGain,
    thresholds: {
      median_efficiency_ratio_min: thresholds.metrics.median_efficiency_ratio_min
    },
    failed_metrics: failedMetrics
  };
}

function canonicalizeForJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForJson(entry));
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value).sort(compareStringsCodePoint);
    const normalized = {};
    for (const key of keys) {
      normalized[key] = canonicalizeForJson(value[key]);
    }
    return normalized;
  }

  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deriveIds({ toolVersion, inputs, trace, payload }) {
  const normalizedForHash = canonicalizeForJson({
    artifact_type: REPORT_ARTIFACT_TYPE,
    schema_version: REPORT_SCHEMA_VERSION,
    tool_version: toolVersion,
    inputs,
    trace,
    payload
  });
  const contentHash = sha256(JSON.stringify(normalizedForHash));
  return {
    run_id: `run_m2_bench_${contentHash.slice(0, 16)}`,
    artifact_id: `lbr_${contentHash.slice(16, 32)}`
  };
}

function createReport({ config, thresholds, results, toolVersion }) {
  const baselineTotal = results.reduce((sum, result) => sum + result.baseline_tokens, 0);
  const lsTotal = results.reduce((sum, result) => sum + result.ls_tokens, 0);
  const efficiencyRatios = results.map((result) => result.efficiency_ratio);
  const medianEfficiencyRatio = median(efficiencyRatios);
  const p90EfficiencyRatio = percentileNearestRank(efficiencyRatios, 90);
  const qualityFloorSummary = createAggregateQualityFloorSummary(results);
  const m2ObjectiveEvaluation = createGateEvaluation({
    medianEfficiencyRatio,
    qualityFloorSummary,
    thresholds
  });
  const topLevelInputs = normalizeArtifactRefList(
    [...config.inputs, ...results.flatMap((result) => result.inputs)],
    "derived_inputs"
  );

  const payload = {
    formula: EFFICIENCY_RATIO_FORMULA,
    tasks: results,
    aggregates: {
      task_count: results.length,
      baseline_tokens_total: baselineTotal,
      ls_tokens_total: lsTotal,
      efficiency_ratio_total: safeDivide(baselineTotal, lsTotal),
      median_efficiency_ratio: medianEfficiencyRatio,
      p90_efficiency_ratio: p90EfficiencyRatio
    },
    quality_floor_summary: qualityFloorSummary,
    m2_objective_evaluation: m2ObjectiveEvaluation
  };
  const trace = {
    suite_id: config.suite_id,
    task_config_schema_version: config.schema_version,
    threshold_id: thresholds.threshold_id
  };
  const ids = deriveIds({
    toolVersion,
    inputs: topLevelInputs,
    trace,
    payload
  });

  return {
    artifact_type: REPORT_ARTIFACT_TYPE,
    schema_version: REPORT_SCHEMA_VERSION,
    artifact_id: ids.artifact_id,
    run_id: ids.run_id,
    produced_at_utc: DETERMINISTIC_PRODUCED_AT_UTC,
    tool_version: toolVersion,
    inputs: topLevelInputs,
    trace,
    payload
  };
}

function main() {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  const packageJsonPath = resolve(projectRoot, "package.json");
  const packageJson = parseJsonFile(packageJsonPath);
  const packageVersion =
    typeof packageJson?.version === "string" && packageJson.version.trim().length > 0
      ? packageJson.version.trim()
      : "0.0.0";
  const toolVersion = `l-semantica@${packageVersion}`;
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolveCliPath(options.configPath, "tasks.json", scriptDirectory);
  const thresholdsPath = resolveCliPath(
    options.thresholdsPath,
    DEFAULT_THRESHOLDS_RELATIVE_PATH,
    scriptDirectory
  );
  const outputPath = resolveCliPath(
    options.outputPath,
    DEFAULT_REPORT_RELATIVE_PATH,
    scriptDirectory
  );

  const config = normalizeTaskConfigFile(parseJsonFile(configPath));
  const thresholds = normalizeThresholdConfig(parseJsonFile(thresholdsPath));
  const results = config.tasks.map((task) => runTask(task, projectRoot));
  const report = createReport({ config, thresholds, results, toolVersion });
  const gatePass = report.payload.m2_objective_evaluation.failed_metrics.length === 0;
  const ok = options.enforceThresholds ? gatePass : true;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok,
        report_path: outputPath,
        task_count: report.payload.aggregates.task_count,
        gate_pass: gatePass,
        failed_metrics: report.payload.m2_objective_evaluation.failed_metrics,
        valid_gain: report.payload.m2_objective_evaluation.valid_gain
      },
      null,
      2
    )
  );

  if (!ok) {
    process.exitCode = 1;
  }
}

main();
