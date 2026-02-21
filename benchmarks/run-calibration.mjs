import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadReliabilityFixtureCorpus } from "./reliability-corpus.mjs";
import { runRuleFirstRepairLoop } from "../runtime/src/index.ts";

const REPORT_SCHEMA_VERSION = "0.1.0";
const CALIBRATION_BANDS = ["low", "medium", "high"];
const DETERMINISTIC_GENERATED_AT = "2026-02-21T00:00:00.000Z";
const DETERMINISTIC_FEEDBACK_TIMESTAMP = new Date("2026-02-21T23:00:00.000Z");

function parseArgs(argv) {
  const options = {};

  function readOptionValue(flagName, valueCandidate) {
    if (!valueCandidate || valueCandidate === "--" || valueCandidate.startsWith("-")) {
      throw new Error(`Missing value for ${flagName}`);
    }

    return valueCandidate;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      break;
    }

    if (arg === "--config") {
      options.configPath = readOptionValue("--config", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.outputPath = readOptionValue("--out", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node --experimental-strip-types benchmarks/run-calibration.mjs [--config <path>] [--out <path>]"
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

  return resolve(process.cwd(), pathOrUndefined);
}

function readSingleFeedbackTensorEntry(feedbackTensorPath, fixtureId) {
  const lines = readFileSync(feedbackTensorPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  if (lines.length !== 1) {
    throw new Error(
      `Fixture ${fixtureId} expected one FeedbackTensor entry, received ${lines.length} at ${feedbackTensorPath}`
    );
  }

  let entry;
  try {
    entry = JSON.parse(lines[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Fixture ${fixtureId} emitted invalid FeedbackTensor JSON at ${feedbackTensorPath}: ${message}`
    );
  }

  const score = entry?.confidence?.score;
  const calibrationBand = entry?.confidence?.calibration_band;
  if (typeof score !== "number" || Number.isFinite(score) === false) {
    throw new Error(`Fixture ${fixtureId} emitted invalid confidence.score`);
  }

  if (typeof calibrationBand !== "string" || calibrationBand.trim().length === 0) {
    throw new Error(`Fixture ${fixtureId} emitted invalid confidence.calibration_band`);
  }

  return {
    score,
    calibration_band: calibrationBand
  };
}

function createBucketSummary(results) {
  const summaryByBand = new Map(
    CALIBRATION_BANDS.map((calibrationBand) => [
      calibrationBand,
      {
        calibration_band: calibrationBand,
        evaluated_count: 0,
        pass_count: 0,
        fail_count: 0
      }
    ])
  );

  for (const result of results) {
    const expectedBand = result.expected.calibration_band;
    const bucket = summaryByBand.get(expectedBand);
    if (!bucket) {
      continue;
    }

    bucket.evaluated_count += 1;
    if (result.pass) {
      bucket.pass_count += 1;
    } else {
      bucket.fail_count += 1;
    }
  }

  return CALIBRATION_BANDS.map((calibrationBand) => summaryByBand.get(calibrationBand));
}

function evaluateCalibrationFixtures(corpus) {
  const fixturesWithExpectedConfidence = corpus.fixtures.filter(
    (fixture) => fixture.expected?.expected_confidence !== undefined
  );

  const tempRoot = mkdtempSync(join(tmpdir(), "l-semantica-calibration-report-"));
  try {
    const results = fixturesWithExpectedConfidence.map((fixture) => {
      const feedbackTensorPath = resolve(tempRoot, `${fixture.id}.ndjson`);
      runRuleFirstRepairLoop(
        {
          failureClass: fixture.failure_class,
          stage: fixture.input.stage,
          artifact: fixture.input.artifact,
          excerpt: fixture.input.excerpt
        },
        {
          feedbackTensorPath,
          runId: `run-calibration-${fixture.id}`,
          feedbackIdFactory: () => `ft-calibration-${fixture.id}`,
          now: () => DETERMINISTIC_FEEDBACK_TIMESTAMP
        }
      );

      const observed = readSingleFeedbackTensorEntry(feedbackTensorPath, fixture.id);
      const expected = fixture.expected.expected_confidence;
      const scoreWithinRange =
        observed.score >= expected.score_min && observed.score <= expected.score_max;
      const bandMatches = observed.calibration_band === expected.calibration_band;

      return {
        fixture_id: fixture.id,
        failure_class: fixture.failure_class,
        expected: {
          score_min: expected.score_min,
          score_max: expected.score_max,
          calibration_band: expected.calibration_band
        },
        observed: {
          score: observed.score,
          calibration_band: observed.calibration_band
        },
        pass: scoreWithinRange && bandMatches
      };
    });

    return {
      results,
      evaluatedFixtureCount: fixturesWithExpectedConfidence.length
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createReport(params) {
  const passCount = params.results.filter((result) => result.pass).length;
  const failCount = params.results.length - passCount;

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: DETERMINISTIC_GENERATED_AT,
    corpus_id: params.corpusId,
    fixture_count: params.fixtureCount,
    evaluated_fixture_count: params.evaluatedFixtureCount,
    results: params.results,
    bucket_summary: createBucketSummary(params.results),
    aggregate: {
      pass_count: passCount,
      fail_count: failCount
    }
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
  const outputPath = resolveCliPath(options.outputPath, "reports/calibration-report.json", scriptDirectory);
  const { corpus } = loadReliabilityFixtureCorpus({ corpusPath: configPath });
  const evaluated = evaluateCalibrationFixtures(corpus);
  const report = createReport({
    corpusId: corpus.corpus_id,
    fixtureCount: corpus.fixtures.length,
    evaluatedFixtureCount: evaluated.evaluatedFixtureCount,
    results: evaluated.results
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        report_path: outputPath,
        fixture_count: report.fixture_count,
        evaluated_fixture_count: report.evaluated_fixture_count,
        pass_count: report.aggregate.pass_count,
        fail_count: report.aggregate.fail_count
      },
      null,
      2
    )
  );
}

main();
