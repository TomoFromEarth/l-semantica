import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { type JsonSchemaSubset, validateJsonSchemaSubset } from "./helpers/json-schema-subset.ts";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const semanticIrSchema = loadJson("../../docs/spec/schemas/semanticir-v0.schema.json") as JsonSchemaSubset;
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

test("SemanticIR v0 schema accepts canonical valid example", () => {
  const result = validateJsonSchemaSubset(semanticIrSchema, canonicalValidExample);

  assert.equal(result.valid, true, result.errors.join("\n"));
});

for (const invalidExample of invalidExamples) {
  test(`SemanticIR v0 schema rejects invalid example: ${invalidExample.name}`, () => {
    const result = validateJsonSchemaSubset(semanticIrSchema, invalidExample.value);

    assert.equal(result.valid, false);
  });
}
