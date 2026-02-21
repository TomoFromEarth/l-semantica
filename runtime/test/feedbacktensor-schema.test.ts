import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const feedbackTensorSchema = loadJson("../../docs/spec/schemas/feedbacktensor-v1.schema.json") as object;
const validExamples = [
  {
    name: "recoverable-parse-repair",
    value: loadJson("../../docs/spec/examples/feedbacktensor/valid/recoverable-parse-repair.json")
  },
  {
    name: "non-recoverable-policy-gate",
    value: loadJson("../../docs/spec/examples/feedbacktensor/valid/non-recoverable-policy-gate.json")
  }
];
const invalidExamples = [
  {
    name: "missing-schema-version",
    value: loadJson("../../docs/spec/examples/feedbacktensor/invalid/missing-schema-version.json"),
    expectedErrorSnippet: "schema_version"
  },
  {
    name: "confidence-score-out-of-range",
    value: loadJson("../../docs/spec/examples/feedbacktensor/invalid/confidence-score-out-of-range.json"),
    expectedErrorSnippet: "/confidence/score"
  },
  {
    name: "proposed-repair-action-missing-rationale",
    value: loadJson(
      "../../docs/spec/examples/feedbacktensor/invalid/proposed-repair-action-missing-rationale.json"
    ),
    expectedErrorSnippet: "rationale"
  },
  {
    name: "invalid-generated-at-format",
    value: loadJson("../../docs/spec/examples/feedbacktensor/invalid/invalid-generated-at-format.json"),
    expectedErrorSnippet: "generated_at"
  }
];

function createFeedbackTensorValidator(): {
  ajv: Ajv2020;
  validateFeedbackTensor: ReturnType<Ajv2020["compile"]>;
} {
  const ajv = new Ajv2020({ allErrors: true });
  const validateFeedbackTensor = ajv.compile(feedbackTensorSchema);
  return { ajv, validateFeedbackTensor };
}

for (const validExample of validExamples) {
  test(`FeedbackTensor v1 schema accepts valid example: ${validExample.name}`, () => {
    const { ajv, validateFeedbackTensor } = createFeedbackTensorValidator();
    const valid = validateFeedbackTensor(validExample.value);

    assert.equal(valid, true, ajv.errorsText(validateFeedbackTensor.errors, { separator: "\n" }));
  });
}

for (const invalidExample of invalidExamples) {
  test(`FeedbackTensor v1 schema rejects invalid example: ${invalidExample.name}`, () => {
    const { ajv, validateFeedbackTensor } = createFeedbackTensorValidator();
    const valid = validateFeedbackTensor(invalidExample.value);
    const errorText = ajv.errorsText(validateFeedbackTensor.errors, { separator: "\n" });

    assert.equal(valid, false);
    assert.equal(errorText.length > 0, true);
    assert.equal(
      errorText.includes(invalidExample.expectedErrorSnippet),
      true,
      `Expected "${invalidExample.expectedErrorSnippet}" in error output:\n${errorText}`
    );
  });
}
