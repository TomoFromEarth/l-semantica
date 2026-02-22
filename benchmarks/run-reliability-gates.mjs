import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELIABILITY_FAILURE_CLASSES,
  loadReliabilityFixtureCorpus
} from "./reliability-corpus.mjs";
import { runRuleFirstRepairLoop } from "../runtime/src/index.ts";

const REPORT_SCHEMA_VERSION = "0.1.0";
const THRESHOLD_SCHEMA_VERSION = "1.0.0";
const DETERMINISTIC_GENERATED_AT = "2026-02-22T00:00:00.000Z";

function parseArgs(argv) {
  const normalizedArgv = [...argv];
  // `pnpm <script> -- --flag` can pass a leading `--` through to Node argv.
  if (normalizedArgv[0] === "--") {
    normalizedArgv.shift();
  }

  const options = {
    enforceThresholds: false
  };

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
        "Usage: node --experimental-strip-types benchmarks/run-reliability-gates.mjs [--config <path>] [--thresholds <path>] [--out <path>] [--enforce-thresholds]"
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveCliPath(pathOrUndefined, defaultRelativePath, scriptDirectory) {
  if (typeof pathOrUndefined !== "string" || pathOrUndefined.trim().length === 0) {
    return resolve(scriptDirectory, defaultRelativePath);
  }

  return resolve(process.cwd(), pathOrUndefined.trim());
}

function parseJsonFile(path, label) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} at ${path}: ${message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label} JSON at ${path}: ${message}`);
  }
}

function assertObject(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Reliability threshold field ${path} must be an object`);
  }

  return value;
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Reliability threshold field ${path} must be a non-empty string`);
  }

  return value.trim();
}

function assertUnitIntervalNumber(value, path) {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    throw new Error(`Reliability threshold field ${path} must be a finite number`);
  }

  if (value < 0 || value > 1) {
    throw new Error(`Reliability threshold field ${path} must be within [0, 1]; received ${value}`);
  }

  return value;
}

function validateThresholdConfig(candidate) {
  const thresholdConfig = assertObject(candidate, "thresholds");
  const schemaVersion = assertNonEmptyString(thresholdConfig.schema_version, "schema_version");
  if (schemaVersion !== THRESHOLD_SCHEMA_VERSION) {
    throw new Error(
      `Reliability threshold schema_version "${schemaVersion}" is incompatible; expected "${THRESHOLD_SCHEMA_VERSION}"`
    );
  }

  const thresholdId = assertNonEmptyString(thresholdConfig.threshold_id, "threshold_id");
  const corpusSchemaVersion = assertNonEmptyString(
    thresholdConfig.corpus_schema_version,
    "corpus_schema_version"
  );
  const metrics = assertObject(thresholdConfig.metrics, "metrics");
  const recoveryRate = assertUnitIntervalNumber(metrics.recovery_rate, "metrics.recovery_rate");
  const safeBlockRate = assertUnitIntervalNumber(metrics.safe_block_rate, "metrics.safe_block_rate");
  const safeAllowRate = assertUnitIntervalNumber(metrics.safe_allow_rate, "metrics.safe_allow_rate");

  return {
    schema_version: schemaVersion,
    threshold_id: thresholdId,
    corpus_schema_version: corpusSchemaVersion,
    metrics: {
      recovery_rate: recoveryRate,
      safe_block_rate: safeBlockRate,
      safe_allow_rate: safeAllowRate
    }
  };
}

function safeRate(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function validateCorpusCoverageForGates(corpus) {
  const coverageByClass = new Map(
    RELIABILITY_FAILURE_CLASSES.map((failureClass) => [failureClass, new Set()])
  );
  for (const fixture of corpus.fixtures) {
    const coverage = coverageByClass.get(fixture.failure_class);
    if (!coverage) {
      continue;
    }

    coverage.add(fixture.recoverability);
  }

  const missingCoverage = [];
  for (const failureClass of RELIABILITY_FAILURE_CLASSES) {
    const coverage = coverageByClass.get(failureClass);
    if (!coverage?.has("recoverable")) {
      missingCoverage.push(`${failureClass}:recoverable`);
    }

    if (!coverage?.has("non_recoverable")) {
      missingCoverage.push(`${failureClass}:non_recoverable`);
    }
  }

  if (missingCoverage.length > 0) {
    throw new Error(
      `Reliability corpus missing required recoverability coverage for gate metrics: ${missingCoverage.join(", ")}`
    );
  }
}

function evaluateFixtures(corpus) {
  return corpus.fixtures.map((fixture) => {
    const observed = runRuleFirstRepairLoop({
      failureClass: fixture.failure_class,
      stage: fixture.input.stage,
      artifact: fixture.input.artifact,
      excerpt: fixture.input.excerpt
    });

    const expectedContinuationAllowed = fixture.expected.continuation_allowed;
    const observedContinuationAllowed = observed.continuationAllowed;
    const recoverableFixture = fixture.recoverability === "recoverable";
    const nonRecoverableFixture = fixture.recoverability === "non_recoverable";

    const recovered = recoverableFixture && observed.decision === "repaired";
    const blockedUnsafeContinuation =
      nonRecoverableFixture && expectedContinuationAllowed === false && observedContinuationAllowed === false;
    const unsafeContinuationAllowed =
      nonRecoverableFixture && expectedContinuationAllowed === false && observedContinuationAllowed === true;
    const allowedCompliantContinuation =
      recoverableFixture && expectedContinuationAllowed === true && observedContinuationAllowed === true;
    const compliantContinuationBlocked =
      recoverableFixture && expectedContinuationAllowed === true && observedContinuationAllowed === false;
    const classificationMatches = observed.classification === fixture.expected.classification;

    return {
      fixture_id: fixture.id,
      failure_class: fixture.failure_class,
      recoverability: fixture.recoverability,
      expected: {
        classification: fixture.expected.classification,
        continuation_allowed: expectedContinuationAllowed
      },
      observed: {
        classification: observed.classification,
        decision: observed.decision,
        reason_code: observed.reasonCode,
        continuation_allowed: observedContinuationAllowed
      },
      checks: {
        classification_matches: classificationMatches,
        recovered,
        blocked_unsafe_continuation: blockedUnsafeContinuation,
        unsafe_continuation_allowed: unsafeContinuationAllowed,
        allowed_compliant_continuation: allowedCompliantContinuation,
        compliant_continuation_blocked: compliantContinuationBlocked
      }
    };
  });
}

function createFailureClassSummary(results) {
  const summaryByClass = new Map(
    RELIABILITY_FAILURE_CLASSES.map((failureClass) => [
      failureClass,
      {
        failure_class: failureClass,
        fixture_count: 0,
        recoverable_fixture_count: 0,
        non_recoverable_fixture_count: 0,
        recovered_fixture_count: 0,
        blocked_unsafe_continuation_count: 0,
        unsafe_continuation_allowed_count: 0,
        allowed_compliant_continuation_count: 0,
        compliant_continuation_blocked_count: 0
      }
    ])
  );

  for (const result of results) {
    const bucket = summaryByClass.get(result.failure_class);
    if (!bucket) {
      continue;
    }

    bucket.fixture_count += 1;
    if (result.recoverability === "recoverable") {
      bucket.recoverable_fixture_count += 1;
    } else {
      bucket.non_recoverable_fixture_count += 1;
    }
    if (result.checks.recovered) {
      bucket.recovered_fixture_count += 1;
    }
    if (result.checks.blocked_unsafe_continuation) {
      bucket.blocked_unsafe_continuation_count += 1;
    }
    if (result.checks.unsafe_continuation_allowed) {
      bucket.unsafe_continuation_allowed_count += 1;
    }
    if (result.checks.allowed_compliant_continuation) {
      bucket.allowed_compliant_continuation_count += 1;
    }
    if (result.checks.compliant_continuation_blocked) {
      bucket.compliant_continuation_blocked_count += 1;
    }
  }

  return RELIABILITY_FAILURE_CLASSES.map((failureClass) => {
    const bucket = summaryByClass.get(failureClass);
    if (!bucket) {
      return {
        failure_class: failureClass,
        fixture_count: 0,
        recoverable_fixture_count: 0,
        non_recoverable_fixture_count: 0,
        recovered_fixture_count: 0,
        blocked_unsafe_continuation_count: 0,
        unsafe_continuation_allowed_count: 0,
        allowed_compliant_continuation_count: 0,
        compliant_continuation_blocked_count: 0,
        recovery_rate: 0,
        safe_block_rate: 0,
        safe_allow_rate: 0
      };
    }

    return {
      ...bucket,
      recovery_rate: safeRate(bucket.recovered_fixture_count, bucket.recoverable_fixture_count),
      safe_block_rate: safeRate(
        bucket.blocked_unsafe_continuation_count,
        bucket.non_recoverable_fixture_count
      ),
      safe_allow_rate: safeRate(
        bucket.allowed_compliant_continuation_count,
        bucket.recoverable_fixture_count
      )
    };
  });
}

function createAggregate(results, thresholds) {
  const recoverableResults = results.filter((result) => result.recoverability === "recoverable");
  const nonRecoverableResults = results.filter((result) => result.recoverability === "non_recoverable");
  const recoveredFixtureCount = recoverableResults.filter((result) => result.checks.recovered).length;
  const blockedUnsafeContinuationCount = nonRecoverableResults.filter(
    (result) => result.checks.blocked_unsafe_continuation
  ).length;
  const unsafeContinuationAllowedCount = nonRecoverableResults.filter(
    (result) => result.checks.unsafe_continuation_allowed
  ).length;
  const allowedCompliantContinuationCount = recoverableResults.filter(
    (result) => result.checks.allowed_compliant_continuation
  ).length;
  const compliantContinuationBlockedCount = recoverableResults.filter(
    (result) => result.checks.compliant_continuation_blocked
  ).length;
  const classificationMatchCount = results.filter((result) => result.checks.classification_matches).length;
  const classificationMismatchCount = results.length - classificationMatchCount;

  const recoveryRate = safeRate(recoveredFixtureCount, recoverableResults.length);
  const safeBlockRate = safeRate(blockedUnsafeContinuationCount, nonRecoverableResults.length);
  const safeAllowRate = safeRate(allowedCompliantContinuationCount, recoverableResults.length);

  const recoveryPass = recoveryRate >= thresholds.metrics.recovery_rate;
  const safeBlockPass = safeBlockRate >= thresholds.metrics.safe_block_rate;
  const safeAllowPass = safeAllowRate >= thresholds.metrics.safe_allow_rate;
  const failedMetrics = [];
  if (!recoveryPass) {
    failedMetrics.push("recovery_rate");
  }
  if (!safeBlockPass) {
    failedMetrics.push("safe_block_rate");
  }
  if (!safeAllowPass) {
    failedMetrics.push("safe_allow_rate");
  }

  return {
    recovery: {
      recoverable_fixture_count: recoverableResults.length,
      recovered_fixture_count: recoveredFixtureCount,
      recovery_rate: recoveryRate,
      threshold: thresholds.metrics.recovery_rate,
      pass: recoveryPass
    },
    safe_continuation: {
      non_recoverable_fixture_count: nonRecoverableResults.length,
      blocked_unsafe_continuation_count: blockedUnsafeContinuationCount,
      unsafe_continuation_allowed_count: unsafeContinuationAllowedCount,
      safe_block_rate: safeBlockRate,
      safe_block_rate_threshold: thresholds.metrics.safe_block_rate,
      safe_block_rate_pass: safeBlockPass,
      recoverable_fixture_count: recoverableResults.length,
      allowed_compliant_continuation_count: allowedCompliantContinuationCount,
      compliant_continuation_blocked_count: compliantContinuationBlockedCount,
      safe_allow_rate: safeAllowRate,
      safe_allow_rate_threshold: thresholds.metrics.safe_allow_rate,
      safe_allow_rate_pass: safeAllowPass
    },
    classification: {
      fixture_count: results.length,
      match_count: classificationMatchCount,
      mismatch_count: classificationMismatchCount,
      match_rate: safeRate(classificationMatchCount, results.length)
    },
    gates: {
      pass: recoveryPass && safeBlockPass && safeAllowPass,
      failed_metrics: failedMetrics
    }
  };
}

function createReport(params) {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: DETERMINISTIC_GENERATED_AT,
    corpus_id: params.corpus.corpus_id,
    corpus_schema_version: params.corpus.schema_version,
    thresholds: params.thresholds,
    fixture_count: params.results.length,
    results: params.results,
    aggregate: createAggregate(params.results, params.thresholds),
    by_failure_class: createFailureClassSummary(params.results)
  };
}

function main() {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolveCliPath(
    options.configPath,
    "fixtures/reliability/failure-corpus.v0.json",
    scriptDirectory
  );
  const thresholdsPath = resolveCliPath(
    options.thresholdsPath,
    "reliability-gates-thresholds.v1.json",
    scriptDirectory
  );
  const outputPath = resolveCliPath(
    options.outputPath,
    "reports/reliability-gates-report.json",
    scriptDirectory
  );

  const { corpus } = loadReliabilityFixtureCorpus({ corpusPath: configPath });
  const thresholds = validateThresholdConfig(parseJsonFile(thresholdsPath, "reliability thresholds"));

  if (thresholds.corpus_schema_version !== corpus.schema_version) {
    throw new Error(
      `Reliability thresholds corpus_schema_version "${thresholds.corpus_schema_version}" does not match corpus schema_version "${corpus.schema_version}"`
    );
  }
  validateCorpusCoverageForGates(corpus);

  const results = evaluateFixtures(corpus);
  const report = createReport({ corpus, thresholds, results });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const gatePass = report.aggregate.gates.pass;
  const enforceThresholds = options.enforceThresholds;
  const ok = enforceThresholds ? gatePass : true;
  console.log(
    JSON.stringify(
      {
        ok,
        report_path: outputPath,
        fixture_count: report.fixture_count,
        gate_pass: gatePass,
        failed_metrics: report.aggregate.gates.failed_metrics
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
