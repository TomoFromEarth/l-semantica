import assert from "node:assert/strict";
import test from "node:test";

import { runSemanticIr } from "../src/index.ts";

test("runSemanticIr returns trace id", () => {
  const result = runSemanticIr({ version: "0.1.0", goal: "ship parser" });

  assert.equal(result.ok, true);
  assert.equal(result.traceId, "trace-0.1.0");
});

test("runSemanticIr validates required fields", () => {
  assert.throws(() => runSemanticIr({ version: " ", goal: "ship parser" }), {
    message: "SemanticIR version is required"
  });

  assert.throws(() => runSemanticIr({ version: "0.1.0", goal: "   " }), {
    message: "SemanticIR goal is required"
  });
});
