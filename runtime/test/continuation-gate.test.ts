import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RuntimeContinuationGateError,
  createFeedbackTensorEntry,
  evaluateContinuationGate,
  loadRuntimeContracts,
  runSemanticIr,
  type FeedbackTensorV1,
  type VerificationStatusSummary
} from "../src/index.ts";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

const validSemanticIr = loadJson("../../docs/spec/examples/semanticir/valid/canonical-v0.json");
const validPolicyProfile = loadJson(
  "../../docs/spec/examples/policyprofile/valid/production-restricted.json"
);
const strictStopVerificationContract = loadJson(
  "../../docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json"
);
const escalateVerificationContract = loadJson(
  "../../docs/spec/examples/verificationcontract/valid/escalate-on-failure-with-thresholds.json"
);

function createFeedbackEvidence(): FeedbackTensorV1 {
  return createFeedbackTensorEntry({
    feedbackId: "ft-gate-test-001",
    generatedAt: "2026-02-21T23:10:00.000Z",
    failureSignal: {
      class: "policy_gate",
      stage: "policy",
      summary: "Policy gate flagged verification precondition.",
      continuationAllowed: false,
      errorCode: "POLICY_PRECONDITION"
    },
    confidence: {
      score: 0.8,
      rationale: "Deterministic verification evidence assembled.",
      calibrationBand: "high"
    },
    alternatives: [
      {
        id: "alt-review",
        hypothesis: "Escalate for manual verification.",
        expected_outcome: "Human review confirms policy-safe continuation."
      }
    ],
    proposedRepairAction: {
      action: "request_manual_review",
      rationale: "Manual review requested by verification policy.",
      requires_human_approval: true,
      target: "policy_gate"
    },
    provenance: {
      runId: "run-gate-test-001",
      sourceStage: "policy_gate",
      contractVersions: {
        semanticIr: "0.1.0",
        policyProfile: "0.1.0"
      }
    }
  });
}

function createStrictPassVerificationStatus(): VerificationStatusSummary {
  return {
    checks: [
      { id: "runtime.contract-loader", kind: "test", passed: true },
      { id: "runtime.feedbacktensor-schema", kind: "test", passed: true },
      { id: "workspace.lint", kind: "static_analysis", passed: true },
      { id: "workspace.typecheck", kind: "static_analysis", passed: true }
    ],
    warningCount: 0
  };
}

test("continuation gate allows continuation for compliant policy and verification evidence", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: strictStopVerificationContract
  });

  const decision = evaluateContinuationGate({
    verificationContract: runtimeContracts.verificationContract,
    policyProfile: runtimeContracts.policyProfile,
    verificationStatus: createStrictPassVerificationStatus(),
    feedbackTensor: createFeedbackEvidence()
  });

  assert.equal(decision.decision, "continue");
  assert.equal(decision.reasonCode, "VERIFICATION_GATE_PASSED");
  assert.equal(decision.continuationAllowed, true);
});

test("continuation gate escalates when required policy assertions fail", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: escalateVerificationContract
  });

  const decision = evaluateContinuationGate({
    verificationContract: runtimeContracts.verificationContract,
    policyProfile: runtimeContracts.policyProfile,
    verificationStatus: {
      checks: [
        { id: "runtime.reliability-corpus", kind: "test", passed: true },
        { id: "workspace.typecheck", kind: "static_analysis", passed: true }
      ],
      warningCount: 0
    },
    feedbackTensor: createFeedbackEvidence()
  });

  assert.equal(decision.decision, "escalate");
  assert.equal(decision.reasonCode, "VERIFICATION_POLICY_ASSERTION_FAILED");
  assert.equal(decision.failedPolicyAssertionIds.includes("policy.max-autonomous-steps"), true);
});

test("continuation gate stops when required feedback evidence fields are missing", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: strictStopVerificationContract
  });
  const feedbackWithAllFields = createFeedbackEvidence();
  const { provenance: _unusedProvenance, ...feedbackWithoutProvenance } = feedbackWithAllFields;

  const decision = evaluateContinuationGate({
    verificationContract: runtimeContracts.verificationContract,
    policyProfile: runtimeContracts.policyProfile,
    verificationStatus: createStrictPassVerificationStatus(),
    feedbackTensor: feedbackWithoutProvenance
  });

  assert.equal(decision.decision, "stop");
  assert.equal(decision.reasonCode, "VERIFICATION_REQUIRED_FEEDBACK_MISSING");
  assert.equal(decision.missingFeedbackFields.includes("provenance"), true);
});

test("continuation gate requires policy profile when policy assertions must be evaluated", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: strictStopVerificationContract
  });
  const verificationContractWithoutPolicyRequirement = {
    ...runtimeContracts.verificationContract,
    continuation: {
      ...runtimeContracts.verificationContract.continuation,
      require_policy_profile: false
    }
  };

  const decision = evaluateContinuationGate({
    verificationContract: verificationContractWithoutPolicyRequirement,
    verificationStatus: createStrictPassVerificationStatus(),
    feedbackTensor: createFeedbackEvidence()
  });

  assert.equal(decision.decision, "stop");
  assert.equal(decision.reasonCode, "POLICY_PROFILE_REQUIRED");
});

test("runSemanticIr blocks autonomous continuation when verification checks fail threshold", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: strictStopVerificationContract
  });

  assert.throws(
    () =>
      runSemanticIr(
        {
          version: "0.1.0",
          goal: "ship parser"
        },
        {
          continuationGate: {
            verificationContract: runtimeContracts.verificationContract,
            policyProfile: runtimeContracts.policyProfile,
            verificationStatus: {
              checks: [
                { id: "runtime.contract-loader", kind: "test", passed: false },
                { id: "runtime.feedbacktensor-schema", kind: "test", passed: true },
                { id: "workspace.lint", kind: "static_analysis", passed: true },
                { id: "workspace.typecheck", kind: "static_analysis", passed: true }
              ],
              warningCount: 0
            },
            feedbackTensor: createFeedbackEvidence()
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof RuntimeContinuationGateError);
      assert.equal(error.decision, "stop");
      assert.equal(error.code, "VERIFICATION_REQUIRED_CHECKS_BELOW_THRESHOLD");
      return true;
    }
  );
});

test("runSemanticIr returns explicit continuation decision when gate passes", () => {
  const runtimeContracts = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: strictStopVerificationContract
  });

  const result = runSemanticIr(
    {
      version: "0.1.0",
      goal: "ship parser"
    },
    {
      continuationGate: {
        verificationContract: runtimeContracts.verificationContract,
        policyProfile: runtimeContracts.policyProfile,
        verificationStatus: createStrictPassVerificationStatus(),
        feedbackTensor: createFeedbackEvidence()
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.continuationDecision.decision, "continue");
  assert.equal(result.continuationDecision.reasonCode, "VERIFICATION_GATE_PASSED");
});
