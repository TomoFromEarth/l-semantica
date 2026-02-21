import assert from "node:assert/strict";
import test from "node:test";

import {
  RULE_FIRST_REPAIR_ORDER,
  runRuleFirstRepairLoop,
  type RepairLoopInput
} from "../src/index.ts";

function runRepair(input: RepairLoopInput, maxAttempts?: number) {
  return runRuleFirstRepairLoop(input, maxAttempts === undefined ? undefined : { maxAttempts });
}

test("rule-first repair order is deterministic and stable", () => {
  assert.deepEqual(RULE_FIRST_REPAIR_ORDER, [
    "parse.append_missing_goal_quote",
    "parse.truncated_context",
    "schema_contract.normalize_schema_version_whitespace",
    "schema_contract.reject_incompatible_schema_version",
    "policy_gate.apply_budget_fallback_plan",
    "policy_gate.terminal_deny_production_destructive_write",
    "capability_denied.downgrade_to_readonly_flow",
    "capability_denied.required_network_capability_missing",
    "deterministic_runtime.retry_timeout_then_recover",
    "deterministic_runtime.terminal_invariant_violation",
    "stochastic_extraction_uncertainty.reprompt_to_raise_confidence",
    "stochastic_extraction_uncertainty.ambiguous_entity_unresolved"
  ]);
});

test("repair loop recovers known parse missing quote failures", () => {
  const result = runRepair({
    failureClass: "parse",
    stage: "compile",
    artifact: "ls_source",
    excerpt: 'goal "Ship release'
  });

  assert.equal(result.decision, "repaired");
  assert.equal(result.continuationAllowed, true);
  assert.equal(result.reasonCode, "PARSE_APPEND_MISSING_QUOTE");
  assert.equal(result.attempts, 1);
  assert.equal(result.appliedRuleId, "parse.append_missing_goal_quote");
  assert.equal(result.repairedExcerpt, 'goal "Ship release"');
});

test("repair loop enforces bounded retries for deterministic timeout failures", () => {
  const result = runRepair(
    {
      failureClass: "deterministic_runtime",
      stage: "runtime",
      artifact: "runtime_event",
      excerpt: "step=resolve_manifest; error=timeout; retryable=true"
    },
    2
  );

  assert.equal(result.decision, "repaired");
  assert.equal(result.continuationAllowed, true);
  assert.equal(result.reasonCode, "DETERMINISTIC_TIMEOUT_RECOVERED");
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    result.history.map((entry) => entry.outcome),
    ["retry", "repaired"]
  );
});

test("repair loop stops when retry budget is exhausted", () => {
  const result = runRepair(
    {
      failureClass: "deterministic_runtime",
      stage: "runtime",
      artifact: "runtime_event",
      excerpt: "step=resolve_manifest; error=timeout; retryable=true"
    },
    1
  );

  assert.equal(result.decision, "stop");
  assert.equal(result.continuationAllowed, false);
  assert.equal(result.reasonCode, "MAX_ATTEMPTS_EXCEEDED");
  assert.equal(result.attempts, 1);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].reasonCode, "DETERMINISTIC_TIMEOUT_RETRY");
});

test("repair loop escalates when no safe deterministic rule matches", () => {
  const result = runRepair({
    failureClass: "parse",
    stage: "compile",
    artifact: "ls_source",
    excerpt: "goal Ship release"
  });

  assert.equal(result.decision, "escalate");
  assert.equal(result.continuationAllowed, false);
  assert.equal(result.reasonCode, "NO_SAFE_DETERMINISTIC_REPAIR");
  assert.equal(result.attempts, 1);
  assert.equal(result.history.length, 0);
});

test("repair loop returns terminal stop for non-recoverable policy denials", () => {
  const result = runRepair({
    failureClass: "policy_gate",
    stage: "policy_gate",
    artifact: "policy_profile",
    excerpt: "action=delete_resource; environment=production; rule=deny"
  });

  assert.equal(result.decision, "stop");
  assert.equal(result.continuationAllowed, false);
  assert.equal(result.reasonCode, "POLICY_DENY_TERMINAL");
  assert.equal(result.attempts, 1);
  assert.equal(result.appliedRuleId, "policy_gate.terminal_deny_production_destructive_write");
});

test("repair loop escalates on incompatible contract schema versions", () => {
  const excerpts = ['"schema_version": "1.0.0"', '"schema_version": "0.2.0"', '"schema_version": "1.0.0-beta"'];

  for (const excerpt of excerpts) {
    const result = runRepair({
      failureClass: "schema_contract",
      stage: "contract_load",
      artifact: "semantic_ir",
      excerpt
    });

    assert.equal(result.decision, "escalate");
    assert.equal(result.continuationAllowed, false);
    assert.equal(result.reasonCode, "SCHEMA_VERSION_INCOMPATIBLE");
    assert.equal(result.attempts, 1);
  }
});

test("repair loop preserves threshold precision in stochastic confidence repair", () => {
  const result = runRepair(
    {
      failureClass: "stochastic_extraction_uncertainty",
      stage: "extraction",
      artifact: "model_output",
      excerpt: "confidence=0.52; threshold=0.805"
    },
    2
  );

  assert.equal(result.decision, "repaired");
  assert.equal(result.reasonCode, "STOCHASTIC_CONFIDENCE_RECOVERED");
  assert.equal(result.repairedExcerpt?.includes("confidence=0.805"), true);
});

test("repair loop stops after bounded retries for unresolved extraction ambiguity", () => {
  const result = runRepair(
    {
      failureClass: "stochastic_extraction_uncertainty",
      stage: "extraction",
      artifact: "model_output",
      excerpt: "top_candidates overlap with confidence delta < 0.02"
    },
    2
  );

  assert.equal(result.decision, "stop");
  assert.equal(result.continuationAllowed, false);
  assert.equal(result.reasonCode, "MAX_ATTEMPTS_EXCEEDED");
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    result.history.map((entry) => entry.reasonCode),
    ["STOCHASTIC_AMBIGUITY_RETRY", "STOCHASTIC_AMBIGUITY_RETRY"]
  );
});

test("repair loop validates maxAttempts option", () => {
  assert.throws(
    () =>
      runRuleFirstRepairLoop({
        failureClass: "parse",
        stage: "compile",
        artifact: "ls_source",
        excerpt: 'goal "Ship release'
      }, {
        maxAttempts: 0
      }),
    /maxAttempts must be an integer greater than or equal to 1/
  );
});
