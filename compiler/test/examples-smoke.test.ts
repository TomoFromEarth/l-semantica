import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runSemanticIr } from "../../runtime/src/index.ts";
import { parseLsDocument } from "../src/index.ts";

interface RuntimeInputArtifact {
  version: string;
  goal: string;
}

function readText(relativePathFromTestFile: string): string {
  return readFileSync(new URL(relativePathFromTestFile, import.meta.url), "utf8");
}

function readRuntimeInputArtifact(relativePathFromTestFile: string): RuntimeInputArtifact {
  return JSON.parse(readText(relativePathFromTestFile)) as RuntimeInputArtifact;
}

test("example smoke flow parses .ls and executes runtime against expected artifact", () => {
  const source = readText("../../examples/first-executable.ls");
  const expectedRuntimeInput = readRuntimeInputArtifact(
    "../../examples/first-executable.runtime-input.json"
  );

  const parseResult = parseLsDocument(source);
  assert.equal(parseResult.diagnostics.length, 0);
  assert.notEqual(parseResult.ast, null);

  if (parseResult.ast === null) {
    assert.fail("Expected example AST to be present");
  }

  const runtimeInput: RuntimeInputArtifact = {
    version: "0.1.0",
    goal: parseResult.ast.goal.value
  };
  assert.deepEqual(runtimeInput, expectedRuntimeInput);

  const runtimeResult = runSemanticIr(runtimeInput);
  assert.equal(runtimeResult.ok, true);
  assert.equal(runtimeResult.traceId, `trace-${expectedRuntimeInput.version}`);
  assert.equal(runtimeResult.continuationDecision.decision, "continue");
  assert.equal(runtimeResult.continuationDecision.reasonCode, "CONTINUATION_GATE_NOT_CONFIGURED");
});
