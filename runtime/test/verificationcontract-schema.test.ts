import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const verificationContractSchema = loadJson(
  "../../docs/spec/schemas/verificationcontract-v1.schema.json"
) as object;
const validExamples = [
  {
    name: "strict-stop-on-failure",
    value: loadJson("../../docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json")
  },
  {
    name: "escalate-on-failure-with-thresholds",
    value: loadJson(
      "../../docs/spec/examples/verificationcontract/valid/escalate-on-failure-with-thresholds.json"
    )
  }
];
const invalidExamples = [
  {
    name: "missing-schema-version",
    value: loadJson("../../docs/spec/examples/verificationcontract/invalid/missing-schema-version.json"),
    expectedErrorSnippet: "schema_version"
  },
  {
    name: "invalid-on-failure-decision",
    value: loadJson(
      "../../docs/spec/examples/verificationcontract/invalid/invalid-on-failure-decision.json"
    ),
    expectedErrorSnippet: "continuation/on_failure"
  },
  {
    name: "pass-ratio-out-of-range",
    value: loadJson("../../docs/spec/examples/verificationcontract/invalid/pass-ratio-out-of-range.json"),
    expectedErrorSnippet: "minimum_required_checks_pass_ratio"
  },
  {
    name: "tests-without-required-check",
    value: loadJson(
      "../../docs/spec/examples/verificationcontract/invalid/tests-without-required-check.json"
    ),
    expectedErrorSnippet: "requirements/tests"
  }
];

function createVerificationContractValidator(): {
  ajv: Ajv2020;
  validateVerificationContract: ReturnType<Ajv2020["compile"]>;
} {
  const ajv = new Ajv2020({ allErrors: true });
  const validateVerificationContract = ajv.compile(verificationContractSchema);
  return { ajv, validateVerificationContract };
}

for (const validExample of validExamples) {
  test(`VerificationContract v1 schema accepts valid example: ${validExample.name}`, () => {
    const { ajv, validateVerificationContract } = createVerificationContractValidator();
    const valid = validateVerificationContract(validExample.value);

    assert.equal(valid, true, ajv.errorsText(validateVerificationContract.errors, { separator: "\n" }));
  });
}

for (const invalidExample of invalidExamples) {
  test(`VerificationContract v1 schema rejects invalid example: ${invalidExample.name}`, () => {
    const { ajv, validateVerificationContract } = createVerificationContractValidator();
    const valid = validateVerificationContract(invalidExample.value);
    const errorText = ajv.errorsText(validateVerificationContract.errors, { separator: "\n" });

    assert.equal(valid, false);
    assert.equal(errorText.length > 0, true);
    assert.equal(
      errorText.includes(invalidExample.expectedErrorSnippet),
      true,
      `Expected "${invalidExample.expectedErrorSnippet}" in error output:\n${errorText}`
    );
  });
}
