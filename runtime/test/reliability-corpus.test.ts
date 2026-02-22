import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  runRuleFirstRepairLoop,
  type FeedbackTensorV1,
  type RepairArtifact,
  type RepairFailureClass,
  type RepairStage
} from "../src/index.ts";

type FailureClass =
  | "parse"
  | "schema_contract"
  | "policy_gate"
  | "capability_denied"
  | "deterministic_runtime"
  | "stochastic_extraction_uncertainty";

type Recoverability = "recoverable" | "non_recoverable";
type CalibrationBand = "low" | "medium" | "high";

interface ReliabilityFixture {
  id: string;
  failure_class: FailureClass;
  scenario: string;
  recoverability: Recoverability;
  expected: {
    classification: FailureClass;
    continuation_allowed: boolean;
    expected_confidence?: {
      score_min: number;
      score_max: number;
      calibration_band: CalibrationBand;
    };
  };
  input: {
    stage: string;
    artifact: string;
    excerpt: string;
  };
}

interface ReliabilityCorpus {
  schema_version: string;
  corpus_id: string;
  description: string;
  fixtures: ReliabilityFixture[];
}

interface ReliabilityFixtureModule {
  RELIABILITY_CORPUS_SCHEMA_VERSION: string;
  RELIABILITY_FAILURE_CLASSES: FailureClass[];
  loadReliabilityFixtureCorpus: (options?: { corpusPath?: string }) => {
    corpusPath: string;
    corpus: ReliabilityCorpus;
  };
  validateReliabilityFixtureCorpus: (corpus: unknown) => void;
}

function getRepoRoot(): string {
  const testDirectory = fileURLToPath(new URL(".", import.meta.url));
  return resolve(testDirectory, "../..");
}

async function loadReliabilityFixtureModule(): Promise<ReliabilityFixtureModule> {
  const modulePath = resolve(getRepoRoot(), "benchmarks/reliability-corpus.mjs");
  const imported = await import(pathToFileURL(modulePath).href);
  return imported as ReliabilityFixtureModule;
}

function readReliabilityCorpus(corpusPath: string): ReliabilityCorpus {
  const source = readFileSync(corpusPath, "utf8");
  return JSON.parse(source) as ReliabilityCorpus;
}

test("reliability fixture corpus loads with required failure-class coverage", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();

  const { corpusPath: loadedCorpusPath, corpus } = fixtureModule.loadReliabilityFixtureCorpus({
    corpusPath
  });

  assert.equal(loadedCorpusPath, corpusPath);
  assert.equal(corpus.schema_version, fixtureModule.RELIABILITY_CORPUS_SCHEMA_VERSION);
  assert.equal(corpus.fixtures.length >= 8, true);

  const coverage = new Map<FailureClass, Set<Recoverability>>();
  for (const failureClass of fixtureModule.RELIABILITY_FAILURE_CLASSES) {
    coverage.set(failureClass, new Set<Recoverability>());
  }

  for (const fixture of corpus.fixtures) {
    assert.equal(fixture.expected.classification, fixture.failure_class);

    if (fixture.recoverability === "recoverable") {
      assert.equal(fixture.expected.continuation_allowed, true);
    }

    if (fixture.recoverability === "non_recoverable") {
      assert.equal(fixture.expected.continuation_allowed, false);
    }

    const recoverabilityValues = coverage.get(fixture.failure_class);
    assert.notEqual(recoverabilityValues, undefined);
    recoverabilityValues?.add(fixture.recoverability);
  }

  for (const failureClass of fixtureModule.RELIABILITY_FAILURE_CLASSES) {
    const recoverabilityValues = coverage.get(failureClass);
    assert.notEqual(recoverabilityValues, undefined);
    assert.equal(recoverabilityValues?.has("recoverable"), true);
    assert.equal(recoverabilityValues?.has("non_recoverable"), true);
  }
});

test("rule-first repair loop matches reliability fixture continuation expectations", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const { corpus } = fixtureModule.loadReliabilityFixtureCorpus({ corpusPath });

  for (const fixture of corpus.fixtures) {
    const result = runRuleFirstRepairLoop({
      failureClass: fixture.failure_class as RepairFailureClass,
      stage: fixture.input.stage as RepairStage,
      artifact: fixture.input.artifact as RepairArtifact,
      excerpt: fixture.input.excerpt
    });

    assert.equal(result.classification, fixture.expected.classification);
    assert.equal(result.continuationAllowed, fixture.expected.continuation_allowed);

    if (fixture.recoverability === "recoverable") {
      assert.equal(result.decision, "repaired");
    } else {
      assert.notEqual(result.decision, "repaired");
    }
  }
});

test("reliability fixture corpus validator rejects failure-class classification mismatch", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const corpus = readReliabilityCorpus(corpusPath);

  corpus.fixtures[0] = {
    ...corpus.fixtures[0],
    failure_class: "parse",
    expected: {
      ...corpus.fixtures[0].expected,
      classification: "schema_contract"
    }
  };

  assert.throws(
    () => fixtureModule.validateReliabilityFixtureCorpus(corpus),
    /expected\.classification must match failure_class/
  );
});

test("reliability fixture corpus validator rejects invalid expected confidence ranges", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const corpus = readReliabilityCorpus(corpusPath);
  const confidenceFixture = corpus.fixtures.find(
    (fixture) =>
      fixture.id === "deterministic-runtime-retriable-timeout-repaired-confidence-recoverable"
  );

  assert.notEqual(confidenceFixture, undefined);
  assert.notEqual(confidenceFixture?.expected.expected_confidence, undefined);
  if (confidenceFixture?.expected.expected_confidence) {
    confidenceFixture.expected.expected_confidence.score_min = 0.95;
    confidenceFixture.expected.expected_confidence.score_max = 0.9;
  }

  assert.throws(
    () => fixtureModule.validateReliabilityFixtureCorpus(corpus),
    /fixture "deterministic-runtime-retriable-timeout-repaired-confidence-recoverable".*score_min must be less than or equal to/
  );
});

test("reliability fixture corpus validator normalizes strings and enforces continuation invariant", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const corpus = readReliabilityCorpus(corpusPath);

  const fixture = corpus.fixtures[0] as unknown as {
    id: string;
    failure_class: string;
    recoverability: string;
    expected: { classification: string; continuation_allowed: boolean };
    input: { stage: string; artifact: string; excerpt: string };
  };

  corpus.schema_version = ` ${corpus.schema_version} `;
  corpus.corpus_id = ` ${corpus.corpus_id} `;
  corpus.description = ` ${corpus.description} `;
  fixture.id = ` ${fixture.id} `;
  fixture.failure_class = " parse ";
  fixture.recoverability = " recoverable ";
  fixture.expected.classification = " parse ";
  fixture.expected.continuation_allowed = false;
  fixture.input.stage = " compile ";
  fixture.input.artifact = " ls_source ";
  fixture.input.excerpt = ` ${fixture.input.excerpt} `;

  assert.throws(
    () => fixtureModule.validateReliabilityFixtureCorpus(corpus),
    /recoverable fixtures must allow continuation/
  );

  fixture.expected.continuation_allowed = true;
  fixtureModule.validateReliabilityFixtureCorpus(corpus);

  assert.equal(corpus.schema_version, fixtureModule.RELIABILITY_CORPUS_SCHEMA_VERSION);
  assert.equal(corpus.corpus_id, "m1-failure-classes-v0");
  assert.equal(corpus.description, "Reliability fixtures for M1 failure-class coverage and continuation expectations.");
  assert.equal(corpus.fixtures[0].id, "parse-missing-goal-quote-recoverable");
  assert.equal(corpus.fixtures[0].failure_class, "parse");
  assert.equal(corpus.fixtures[0].recoverability, "recoverable");
  assert.equal(corpus.fixtures[0].expected.classification, "parse");
  assert.equal(corpus.fixtures[0].input.stage, "compile");
  assert.equal(corpus.fixtures[0].input.artifact, "ls_source");
});

test("repair loop feedback emission matches fixture expected confidence windows", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const { corpus } = fixtureModule.loadReliabilityFixtureCorpus({ corpusPath });
  const confidenceFixtures = corpus.fixtures.filter(
    (fixture): fixture is ReliabilityFixture & {
      expected: ReliabilityFixture["expected"] & {
        expected_confidence: NonNullable<ReliabilityFixture["expected"]["expected_confidence"]>;
      };
    } => fixture.expected.expected_confidence !== undefined
  );

  assert.equal(confidenceFixtures.length > 0, true);

  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-reliability-confidence-"));
  try {
    for (const fixture of confidenceFixtures) {
      const feedbackTensorPath = join(tmpRoot, `${fixture.id}.ndjson`);
      runRuleFirstRepairLoop(
        {
          failureClass: fixture.failure_class as RepairFailureClass,
          stage: fixture.input.stage as RepairStage,
          artifact: fixture.input.artifact as RepairArtifact,
          excerpt: fixture.input.excerpt
        },
        {
          feedbackTensorPath,
          runId: `run-confidence-${fixture.id}`,
          feedbackIdFactory: () => `ft-confidence-${fixture.id}`,
          now: () => new Date("2026-02-21T23:00:00.000Z")
        }
      );

      const lines = readFileSync(feedbackTensorPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
      assert.equal(lines.length, 1, `Fixture ${fixture.id} should emit one feedback tensor entry`);

      const entry = JSON.parse(lines[0]) as FeedbackTensorV1;
      const expectedConfidence = fixture.expected.expected_confidence;
      assert.equal(
        entry.confidence.score >= expectedConfidence.score_min &&
          entry.confidence.score <= expectedConfidence.score_max,
        true,
        `Fixture ${fixture.id} expected confidence score in [${expectedConfidence.score_min}, ${expectedConfidence.score_max}], received ${entry.confidence.score}`
      );
      assert.equal(
        entry.confidence.calibration_band,
        expectedConfidence.calibration_band,
        `Fixture ${fixture.id} expected calibration band ${expectedConfidence.calibration_band}`
      );
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("reliability fixture corpus loader trims corpusPath option", async () => {
  const repoRoot = getRepoRoot();
  const fixtureModule = await loadReliabilityFixtureModule();
  const absolutePath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");

  const { corpusPath, corpus } = fixtureModule.loadReliabilityFixtureCorpus({
    corpusPath: ` ${absolutePath} `
  });

  assert.equal(corpusPath, absolutePath);
  assert.equal(corpus.schema_version, fixtureModule.RELIABILITY_CORPUS_SCHEMA_VERSION);
});

test("reliability fixture corpus loader includes path context on read failures", async () => {
  const repoRoot = getRepoRoot();
  const fixtureModule = await loadReliabilityFixtureModule();
  const missingPath = resolve(repoRoot, "benchmarks/fixtures/reliability/does-not-exist.json");

  assert.throws(
    () =>
      fixtureModule.loadReliabilityFixtureCorpus({
        corpusPath: missingPath
      }),
    (error) => {
      if (!(error instanceof Error)) {
        return false;
      }

      return error.message.startsWith(`Failed to read reliability corpus at ${missingPath}:`);
    }
  );
});

test("reliability fixture corpus validation does not partially mutate on failure", async () => {
  const repoRoot = getRepoRoot();
  const corpusPath = resolve(repoRoot, "benchmarks/fixtures/reliability/failure-corpus.v0.json");
  const fixtureModule = await loadReliabilityFixtureModule();
  const corpus = readReliabilityCorpus(corpusPath);
  const fixture = corpus.fixtures[0] as unknown as {
    failure_class: string;
    expected: { classification: string; continuation_allowed: boolean };
  };

  corpus.schema_version = ` ${corpus.schema_version} `;
  fixture.failure_class = " parse ";
  fixture.expected.classification = " parse ";
  fixture.expected.continuation_allowed = false;

  assert.throws(
    () => fixtureModule.validateReliabilityFixtureCorpus(corpus),
    /recoverable fixtures must allow continuation/
  );

  assert.equal(corpus.schema_version, ` ${fixtureModule.RELIABILITY_CORPUS_SCHEMA_VERSION} `);
  assert.equal(fixture.failure_class, " parse ");
  assert.equal(fixture.expected.classification, " parse ");
});
