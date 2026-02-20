import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const policyProfileSchema = loadJson("../../docs/spec/schemas/policyprofile-v0.schema.json") as object;
const validExamples = [
  {
    name: "development-default",
    value: loadJson("../../docs/spec/examples/policyprofile/valid/development-default.json")
  },
  {
    name: "production-restricted",
    value: loadJson("../../docs/spec/examples/policyprofile/valid/production-restricted.json")
  }
];
const invalidExamples = [
  {
    name: "missing-schema-version",
    value: loadJson("../../docs/spec/examples/policyprofile/invalid/missing-schema-version.json"),
    expectedErrorSnippet: "schema_version"
  },
  {
    name: "production-default-without-manual-approval",
    value: loadJson(
      "../../docs/spec/examples/policyprofile/invalid/production-default-without-manual-approval.json"
    ),
    expectedErrorSnippet: "capability_policy/escalation_requirements/default"
  },
  {
    name: "manual-approval-without-rules",
    value: loadJson("../../docs/spec/examples/policyprofile/invalid/manual-approval-without-rules.json"),
    expectedErrorSnippet: "rules"
  },
  {
    name: "escalation-rule-missing-min-approvals",
    value: loadJson(
      "../../docs/spec/examples/policyprofile/invalid/escalation-rule-missing-min-approvals.json"
    ),
    expectedErrorSnippet: "min_approvals"
  }
];

const ajv = new Ajv2020({ allErrors: true });
const validatePolicyProfile = ajv.compile(policyProfileSchema);

for (const validExample of validExamples) {
  test(`PolicyProfile v0 schema accepts valid example: ${validExample.name}`, () => {
    const valid = validatePolicyProfile(validExample.value);

    assert.equal(valid, true, ajv.errorsText(validatePolicyProfile.errors, { separator: "\n" }));
  });
}

for (const invalidExample of invalidExamples) {
  test(`PolicyProfile v0 schema rejects invalid example: ${invalidExample.name}`, () => {
    const valid = validatePolicyProfile(invalidExample.value);
    const errorText = ajv.errorsText(validatePolicyProfile.errors, { separator: "\n" });

    assert.equal(valid, false);
    assert.equal(errorText.length > 0, true);
    assert.equal(
      errorText.includes(invalidExample.expectedErrorSnippet),
      true,
      `Expected "${invalidExample.expectedErrorSnippet}" in error output:\n${errorText}`
    );
  });
}
