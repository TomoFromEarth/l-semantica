import assert from "node:assert/strict";
import test from "node:test";

import { runSemanticIr, type SemanticIrEnvelope } from "../src/index.ts";

test("runSemanticIr returns trace id", () => {
  const result = runSemanticIr({ version: "0.1.0", goal: "ship parser" });

  assert.equal(result.ok, true);
  assert.equal(result.traceId, "trace-0.1.0");
  assert.equal(result.continuationDecision.decision, "continue");
  assert.equal(result.continuationDecision.reasonCode, "CONTINUATION_GATE_NOT_CONFIGURED");
});

test("runSemanticIr validates required fields", () => {
  assert.throws(() => runSemanticIr({ version: " ", goal: "ship parser" }), {
    message: "SemanticIR version is required"
  });

  assert.throws(() => runSemanticIr({ version: "0.1.0", goal: "   " }), {
    message: "SemanticIR goal is required"
  });
});

test("runSemanticIr validates input types", () => {
  assert.throws(() => runSemanticIr(undefined as unknown as SemanticIrEnvelope), {
    message: "SemanticIR input must be an object"
  });
  assert.throws(() => runSemanticIr([] as unknown as SemanticIrEnvelope), {
    message: "SemanticIR input must be an object"
  });

  assert.throws(
    () => runSemanticIr({ version: 100, goal: "ship parser" } as unknown as SemanticIrEnvelope),
    {
      message: "SemanticIR version is required"
    }
  );

  assert.throws(
    () => runSemanticIr({ version: "0.1.0", goal: 7 } as unknown as SemanticIrEnvelope),
    {
      message: "SemanticIR goal is required"
    }
  );
});
