import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RELIABILITY_CORPUS_SCHEMA_VERSION = "0.1.0";
export const RELIABILITY_FAILURE_CLASSES = [
  "parse",
  "schema_contract",
  "policy_gate",
  "capability_denied",
  "deterministic_runtime",
  "stochastic_extraction_uncertainty"
];

const RECOVERABILITY_VALUES = ["recoverable", "non_recoverable"];
const INPUT_STAGES = ["compile", "contract_load", "policy_gate", "runtime", "extraction"];
const INPUT_ARTIFACTS = [
  "ls_source",
  "semantic_ir",
  "policy_profile",
  "capability_manifest",
  "runtime_event",
  "model_output"
];
const CONFIDENCE_CALIBRATION_BANDS = ["low", "medium", "high"];

function assertObject(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Reliability corpus field ${path} must be an object`);
  }

  return value;
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Reliability corpus field ${path} must be a non-empty string`);
  }

  return value.trim();
}

function assertEnum(value, values, path) {
  const normalized = assertNonEmptyString(value, path);
  if (!values.includes(normalized)) {
    throw new Error(
      `Reliability corpus field ${path} must be one of: ${values.join(", ")}; received "${normalized}"`
    );
  }

  return normalized;
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new Error(`Reliability corpus field ${path} must be a boolean`);
  }

  return value;
}

function assertUnitIntervalNumber(value, path, fixtureId) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Reliability corpus fixture "${fixtureId}" field ${path} must be a finite number`);
  }

  if (value < 0 || value > 1) {
    throw new Error(
      `Reliability corpus fixture "${fixtureId}" field ${path} must be within [0, 1]; received ${value}`
    );
  }

  return value;
}

function validateFixture(candidate, fixtureIndex, seenIds) {
  const fixture = assertObject(candidate, `fixtures[${fixtureIndex}]`);
  const fixturePath = `fixtures[${fixtureIndex}]`;

  const id = assertNonEmptyString(fixture.id, `${fixturePath}.id`);
  fixture.id = id;
  if (seenIds.has(id)) {
    throw new Error(`Reliability corpus fixture id "${id}" must be unique`);
  }

  seenIds.add(id);

  const failureClass = assertEnum(
    fixture.failure_class,
    RELIABILITY_FAILURE_CLASSES,
    `${fixturePath}.failure_class`
  );
  fixture.failure_class = failureClass;

  const scenario = assertNonEmptyString(fixture.scenario, `${fixturePath}.scenario`);
  fixture.scenario = scenario;
  const recoverability = assertEnum(
    fixture.recoverability,
    RECOVERABILITY_VALUES,
    `${fixturePath}.recoverability`
  );
  fixture.recoverability = recoverability;

  const expected = assertObject(fixture.expected, `${fixturePath}.expected`);
  const expectedClassification = assertEnum(
    expected.classification,
    RELIABILITY_FAILURE_CLASSES,
    `${fixturePath}.expected.classification`
  );
  expected.classification = expectedClassification;
  const continuationAllowed = assertBoolean(
    expected.continuation_allowed,
    `${fixturePath}.expected.continuation_allowed`
  );
  expected.continuation_allowed = continuationAllowed;
  if (expected.expected_confidence !== undefined) {
    const confidencePath = `${fixturePath}.expected.expected_confidence`;
    if (
      typeof expected.expected_confidence !== "object" ||
      expected.expected_confidence === null ||
      Array.isArray(expected.expected_confidence)
    ) {
      throw new Error(`Reliability corpus fixture "${id}" field ${confidencePath} must be an object`);
    }

    const expectedConfidence = expected.expected_confidence;
    const scoreMin = assertUnitIntervalNumber(
      expectedConfidence.score_min,
      `${confidencePath}.score_min`,
      id
    );
    const scoreMax = assertUnitIntervalNumber(
      expectedConfidence.score_max,
      `${confidencePath}.score_max`,
      id
    );
    if (scoreMin > scoreMax) {
      throw new Error(
        `Reliability corpus fixture "${id}" field ${confidencePath}.score_min must be less than or equal to ${confidencePath}.score_max`
      );
    }

    const calibrationBand = assertNonEmptyString(
      expectedConfidence.calibration_band,
      `${confidencePath}.calibration_band`
    );
    if (!CONFIDENCE_CALIBRATION_BANDS.includes(calibrationBand)) {
      throw new Error(
        `Reliability corpus fixture "${id}" field ${confidencePath}.calibration_band must be one of: ${CONFIDENCE_CALIBRATION_BANDS.join(
          ", "
        )}; received "${calibrationBand}"`
      );
    }
    expected.expected_confidence = {
      score_min: scoreMin,
      score_max: scoreMax,
      calibration_band: calibrationBand
    };
  }

  if (expectedClassification !== failureClass) {
    throw new Error(
      `Reliability corpus fixture "${id}" expected.classification must match failure_class`
    );
  }

  if (recoverability === "recoverable" && continuationAllowed !== true) {
    throw new Error(
      `Reliability corpus fixture "${id}" recoverable fixtures must allow continuation`
    );
  }

  if (recoverability === "non_recoverable" && continuationAllowed !== false) {
    throw new Error(
      `Reliability corpus fixture "${id}" non_recoverable fixtures must block continuation`
    );
  }

  const input = assertObject(fixture.input, `${fixturePath}.input`);
  const stage = assertEnum(input.stage, INPUT_STAGES, `${fixturePath}.input.stage`);
  const artifact = assertEnum(input.artifact, INPUT_ARTIFACTS, `${fixturePath}.input.artifact`);
  const excerpt = assertNonEmptyString(input.excerpt, `${fixturePath}.input.excerpt`);
  input.stage = stage;
  input.artifact = artifact;
  input.excerpt = excerpt;
}

function validateAndNormalizeCorpus(candidate) {
  const schemaVersion = assertNonEmptyString(candidate.schema_version, "schema_version");
  candidate.schema_version = schemaVersion;
  if (schemaVersion !== RELIABILITY_CORPUS_SCHEMA_VERSION) {
    throw new Error(
      `Reliability corpus schema_version "${schemaVersion}" is incompatible; expected "${RELIABILITY_CORPUS_SCHEMA_VERSION}"`
    );
  }

  const corpusId = assertNonEmptyString(candidate.corpus_id, "corpus_id");
  const description = assertNonEmptyString(candidate.description, "description");
  candidate.corpus_id = corpusId;
  candidate.description = description;

  if (!Array.isArray(candidate.fixtures) || candidate.fixtures.length === 0) {
    throw new Error("Reliability corpus fixtures must be a non-empty array");
  }

  const seenIds = new Set();
  for (let index = 0; index < candidate.fixtures.length; index += 1) {
    validateFixture(candidate.fixtures[index], index, seenIds);
  }
}

function replaceObjectContents(target, source) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, source);
}

export function validateReliabilityFixtureCorpus(corpus) {
  const candidate = assertObject(corpus, "corpus");

  let normalizedCandidate;
  try {
    normalizedCandidate = structuredClone(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Reliability corpus could not be cloned for validation: ${message}`);
  }

  validateAndNormalizeCorpus(normalizedCandidate);
  replaceObjectContents(candidate, normalizedCandidate);
}

function resolveCorpusPath(pathOrUndefined) {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  if (typeof pathOrUndefined !== "string" || pathOrUndefined.trim().length === 0) {
    return resolve(scriptDirectory, "fixtures/reliability/failure-corpus.v0.json");
  }

  return resolve(process.cwd(), pathOrUndefined.trim());
}

export function loadReliabilityFixtureCorpus(options = {}) {
  const normalizedOptions =
    typeof options === "object" && options !== null && !Array.isArray(options) ? options : {};

  const corpusPath = resolveCorpusPath(normalizedOptions.corpusPath);
  let source;
  try {
    source = readFileSync(corpusPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read reliability corpus at ${corpusPath}: ${message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse reliability corpus JSON at ${corpusPath}: ${message}`);
  }

  validateReliabilityFixtureCorpus(parsed);

  return {
    corpusPath,
    corpus: parsed
  };
}
