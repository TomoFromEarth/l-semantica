import assert from "node:assert/strict";
import test from "node:test";

import { parseGoalDeclaration } from "../src/index.ts";

test("parseGoalDeclaration returns normalized goal node", () => {
  const node = parseGoalDeclaration("  build a parser  ");

  assert.equal(node.kind, "GoalDeclaration");
  assert.equal(node.value, "build a parser");
});

test("parseGoalDeclaration throws on empty goal", () => {
  assert.throws(() => parseGoalDeclaration("   "), {
    message: "Goal declaration cannot be empty"
  });
});
