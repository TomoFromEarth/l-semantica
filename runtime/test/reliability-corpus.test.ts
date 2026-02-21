import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

type FailureClass =
  | "parse"
  | "schema_contract"
  | "policy_gate"
  | "capability_denied"
  | "deterministic_runtime"
  | "stochastic_extraction_uncertainty";

type Recoverability = "recoverable" | "non_recoverable";

interface ReliabilityFixture {
  id: string;
  failure_class: FailureClass;
  scenario: string;
  recoverability: Recoverability;
  expected: {
    classification: FailureClass;
    continuation_allowed: boolean;
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

test("reliability fixture corpus validator rejects invalid failure class", async () => {
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
