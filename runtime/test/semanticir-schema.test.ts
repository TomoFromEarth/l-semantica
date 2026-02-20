import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const semanticIrSchema = loadJson("../../docs/spec/schemas/semanticir-v0.schema.json") as object;
const canonicalValidExample = loadJson("../../docs/spec/examples/semanticir/valid/canonical-v0.json");
const invalidExamples = [
  {
    name: "missing-schema-version",
    value: loadJson("../../docs/spec/examples/semanticir/invalid/missing-schema-version.json")
  },
  {
    name: "missing-metadata",
    value: loadJson("../../docs/spec/examples/semanticir/invalid/missing-metadata.json")
  },
  {
    name: "stochastic-node-in-deterministic-list",
    value: loadJson(
      "../../docs/spec/examples/semanticir/invalid/stochastic-node-in-deterministic-list.json"
    )
  }
];

const ajv = new Ajv2020({ allErrors: true });
const validateSemanticIr = ajv.compile(semanticIrSchema);

test("SemanticIR v0 schema accepts canonical valid example", () => {
  const valid = validateSemanticIr(canonicalValidExample);

  assert.equal(valid, true, ajv.errorsText(validateSemanticIr.errors, { separator: "\n" }));
});

for (const invalidExample of invalidExamples) {
  test(`SemanticIR v0 schema rejects invalid example: ${invalidExample.name}`, () => {
    const valid = validateSemanticIr(invalidExample.value);

    assert.equal(valid, false);
  });
}
