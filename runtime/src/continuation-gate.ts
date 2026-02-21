import type {
  PolicyProfileContract,
  VerificationCheckRequirement,
  VerificationContract,
  VerificationPolicyAssertion
} from "./contracts.ts";
import type { FeedbackTensorV1 } from "./feedback-tensor.ts";

export const CONTINUATION_DECISIONS = ["continue", "escalate", "stop"] as const;

export const CONTINUATION_GATE_REASON_CODES = [
  "CONTINUATION_GATE_NOT_CONFIGURED",
  "VERIFICATION_GATE_PASSED",
  "POLICY_PROFILE_REQUIRED",
  "VERIFICATION_STATUS_MISSING",
  "VERIFICATION_CHECK_RESULT_MISSING",
  "VERIFICATION_REQUIRED_CHECKS_BELOW_THRESHOLD",
  "VERIFICATION_POLICY_ASSERTION_FAILED",
  "VERIFICATION_WARNING_LIMIT_EXCEEDED",
  "VERIFICATION_REQUIRED_FEEDBACK_MISSING"
] as const;

export type ContinuationDecision = (typeof CONTINUATION_DECISIONS)[number];
export type ContinuationGateReasonCode = (typeof CONTINUATION_GATE_REASON_CODES)[number];

export interface VerificationCheckResult {
  id: string;
  kind: "test" | "static_analysis";
  passed: boolean;
}

export interface VerificationStatusSummary {
  checks: VerificationCheckResult[];
  warningCount: number;
}

export interface EvaluateContinuationGateInput {
  verificationContract: VerificationContract;
  policyProfile?: PolicyProfileContract;
  verificationStatus?: VerificationStatusSummary;
  feedbackTensor?: Partial<
    Pick<
      FeedbackTensorV1,
      "failure_signal" | "confidence" | "alternatives" | "proposed_repair_action" | "provenance"
    >
  >;
}

export interface ContinuationGateDecision {
  decision: ContinuationDecision;
  continuationAllowed: boolean;
  reasonCode: ContinuationGateReasonCode;
  detail: string;
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  requiredChecksPassRatio: number;
  warningCount: number;
  maxWarningCount: number;
  missingFeedbackFields: string[];
  failedPolicyAssertionIds: string[];
}

interface CheckCoverage {
  passed: number;
  total: number;
  missingRequiredIds: string[];
}

interface PolicyAssertionEvaluation {
  assertion: VerificationPolicyAssertion;
  passed: boolean;
}

const REQUIRED_FEEDBACK_FIELDS = [
  "failure_signal",
  "confidence",
  "alternatives",
  "proposed_repair_action",
  "provenance"
] as const;

type RequiredFeedbackField = (typeof REQUIRED_FEEDBACK_FIELDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeReasonDetailSuffix(items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  return ` (${items.join(", ")})`;
}

function createGateDecision(params: {
  verificationContract: VerificationContract;
  decision: ContinuationDecision;
  reasonCode: ContinuationGateReasonCode;
  detail: string;
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  warningCount: number;
  missingFeedbackFields?: string[];
  failedPolicyAssertionIds?: string[];
}): ContinuationGateDecision {
  const ratio =
    params.requiredChecksTotal === 0 ? 1 : params.requiredChecksPassed / params.requiredChecksTotal;

  return {
    decision: params.decision,
    continuationAllowed: params.decision === "continue",
    reasonCode: params.reasonCode,
    detail: params.detail,
    requiredChecksPassed: params.requiredChecksPassed,
    requiredChecksTotal: params.requiredChecksTotal,
    requiredChecksPassRatio: ratio,
    warningCount: params.warningCount,
    maxWarningCount: params.verificationContract.pass_criteria.max_warning_count,
    missingFeedbackFields: params.missingFeedbackFields ?? [],
    failedPolicyAssertionIds: params.failedPolicyAssertionIds ?? []
  };
}

function createFailureDecision(params: {
  verificationContract: VerificationContract;
  reasonCode: ContinuationGateReasonCode;
  detail: string;
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  warningCount: number;
  missingFeedbackFields?: string[];
  failedPolicyAssertionIds?: string[];
}): ContinuationGateDecision {
  return createGateDecision({
    verificationContract: params.verificationContract,
    decision: params.verificationContract.continuation.on_failure,
    reasonCode: params.reasonCode,
    detail: params.detail,
    requiredChecksPassed: params.requiredChecksPassed,
    requiredChecksTotal: params.requiredChecksTotal,
    warningCount: params.warningCount,
    missingFeedbackFields: params.missingFeedbackFields,
    failedPolicyAssertionIds: params.failedPolicyAssertionIds
  });
}

function hasFeedbackField(
  feedbackTensor: Partial<Record<RequiredFeedbackField, unknown>>,
  field: RequiredFeedbackField
): boolean {
  return Object.prototype.hasOwnProperty.call(feedbackTensor, field) && feedbackTensor[field] !== undefined;
}

function resolveMissingFeedbackFields(
  requiredFields: string[],
  feedbackTensor: EvaluateContinuationGateInput["feedbackTensor"]
): string[] {
  const candidate = feedbackTensor as Partial<Record<RequiredFeedbackField, unknown>> | undefined;
  if (!candidate) {
    return [...requiredFields];
  }

  return requiredFields.filter((field) => !hasFeedbackField(candidate, field as RequiredFeedbackField));
}

function resolveRequiredChecks(
  requirements: VerificationCheckRequirement[],
  kind: VerificationCheckResult["kind"]
): Array<{ id: string; kind: VerificationCheckResult["kind"] }> {
  return requirements
    .filter((requirement) => requirement.required)
    .map((requirement) => ({
      id: requirement.id,
      kind
    }));
}

function resolveCheckCoverage(
  requiredChecks: Array<{ id: string; kind: VerificationCheckResult["kind"] }>,
  verificationStatus: VerificationStatusSummary
): CheckCoverage {
  const index = new Map<string, VerificationCheckResult>(
    verificationStatus.checks.map((check) => [`${check.kind}:${check.id}`, check])
  );
  const missingRequiredIds: string[] = [];
  let passed = 0;

  for (const requiredCheck of requiredChecks) {
    const lookupKey = `${requiredCheck.kind}:${requiredCheck.id}`;
    const result = index.get(lookupKey);
    if (!result) {
      missingRequiredIds.push(lookupKey);
      continue;
    }

    if (result.passed) {
      passed += 1;
    }
  }

  return {
    passed,
    total: requiredChecks.length,
    missingRequiredIds
  };
}

function resolvePolicyPathValue(policyProfile: PolicyProfileContract, policyPath: string): unknown {
  const segments = policyPath.split(".").filter((segment) => segment.length > 0);
  let current: unknown = policyProfile;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function evaluatePolicyAssertions(
  policyProfile: PolicyProfileContract,
  assertions: VerificationPolicyAssertion[]
): PolicyAssertionEvaluation[] {
  return assertions.map((assertion) => ({
    assertion,
    passed: resolvePolicyPathValue(policyProfile, assertion.policy_path) === assertion.expected
  }));
}

export function evaluateContinuationGate(input: EvaluateContinuationGateInput): ContinuationGateDecision {
  const verificationContract = input.verificationContract;
  const requiredFeedbackFields = verificationContract.continuation.required_feedback_tensor_fields;
  const missingFeedbackFields = resolveMissingFeedbackFields(requiredFeedbackFields, input.feedbackTensor);

  if (missingFeedbackFields.length > 0) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_REQUIRED_FEEDBACK_MISSING",
      detail: `Verification evidence is missing required FeedbackTensor fields${normalizeReasonDetailSuffix(
        missingFeedbackFields
      )}.`,
      requiredChecksPassed: 0,
      requiredChecksTotal: 0,
      warningCount: 0,
      missingFeedbackFields
    });
  }

  const requiredChecks = [
    ...resolveRequiredChecks(verificationContract.requirements.tests, "test"),
    ...resolveRequiredChecks(verificationContract.requirements.static_analysis, "static_analysis")
  ];

  const requiredPolicyAssertions = verificationContract.requirements.policy_assertions.filter(
    (assertion) => assertion.required
  );
  const assertionsToEnforce = verificationContract.pass_criteria.require_all_policy_assertions
    ? verificationContract.requirements.policy_assertions
    : requiredPolicyAssertions;

  if (verificationContract.continuation.require_policy_profile && !input.policyProfile) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "POLICY_PROFILE_REQUIRED",
      detail: "Verification continuation policy requires a validated PolicyProfile contract.",
      requiredChecksPassed: 0,
      requiredChecksTotal: requiredChecks.length + requiredPolicyAssertions.length,
      warningCount: 0
    });
  }

  if (!input.verificationStatus) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_STATUS_MISSING",
      detail: "Verification status summary is required to evaluate continuation.",
      requiredChecksPassed: 0,
      requiredChecksTotal: requiredChecks.length + requiredPolicyAssertions.length,
      warningCount: 0
    });
  }

  const checkCoverage = resolveCheckCoverage(requiredChecks, input.verificationStatus);
  if (checkCoverage.missingRequiredIds.length > 0) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_CHECK_RESULT_MISSING",
      detail: `Verification status is missing required check results${normalizeReasonDetailSuffix(
        checkCoverage.missingRequiredIds
      )}.`,
      requiredChecksPassed: checkCoverage.passed,
      requiredChecksTotal: requiredChecks.length + requiredPolicyAssertions.length,
      warningCount: input.verificationStatus.warningCount
    });
  }

  const policyEvaluations = input.policyProfile
    ? evaluatePolicyAssertions(input.policyProfile, assertionsToEnforce)
    : [];
  const failedPolicyAssertionIds = policyEvaluations
    .filter((evaluation) => !evaluation.passed)
    .map((evaluation) => evaluation.assertion.id);
  const passedRequiredPolicyAssertions = policyEvaluations.filter(
    (evaluation) => evaluation.assertion.required && evaluation.passed
  ).length;

  if (failedPolicyAssertionIds.length > 0) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_POLICY_ASSERTION_FAILED",
      detail: `Policy assertion verification failed${normalizeReasonDetailSuffix(
        failedPolicyAssertionIds
      )}.`,
      requiredChecksPassed: checkCoverage.passed + passedRequiredPolicyAssertions,
      requiredChecksTotal: requiredChecks.length + requiredPolicyAssertions.length,
      warningCount: input.verificationStatus.warningCount,
      failedPolicyAssertionIds
    });
  }

  const requiredChecksPassed = checkCoverage.passed + passedRequiredPolicyAssertions;
  const requiredChecksTotal = requiredChecks.length + requiredPolicyAssertions.length;
  const minimumRequiredChecksPassRatio =
    verificationContract.pass_criteria.minimum_required_checks_pass_ratio;
  const requiredChecksPassRatio =
    requiredChecksTotal === 0 ? 1 : requiredChecksPassed / requiredChecksTotal;

  if (requiredChecksPassRatio < minimumRequiredChecksPassRatio) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_REQUIRED_CHECKS_BELOW_THRESHOLD",
      detail: `Required verification pass ratio ${requiredChecksPassRatio.toFixed(
        2
      )} is below minimum ${minimumRequiredChecksPassRatio.toFixed(2)}.`,
      requiredChecksPassed,
      requiredChecksTotal,
      warningCount: input.verificationStatus.warningCount
    });
  }

  if (input.verificationStatus.warningCount > verificationContract.pass_criteria.max_warning_count) {
    return createFailureDecision({
      verificationContract,
      reasonCode: "VERIFICATION_WARNING_LIMIT_EXCEEDED",
      detail: `Verification warnings ${input.verificationStatus.warningCount} exceed max allowed ${verificationContract.pass_criteria.max_warning_count}.`,
      requiredChecksPassed,
      requiredChecksTotal,
      warningCount: input.verificationStatus.warningCount
    });
  }

  return createGateDecision({
    verificationContract,
    decision: verificationContract.continuation.on_success,
    reasonCode: "VERIFICATION_GATE_PASSED",
    detail: "Verification and policy checks passed; autonomous continuation is allowed.",
    requiredChecksPassed,
    requiredChecksTotal,
    warningCount: input.verificationStatus.warningCount
  });
}

export function createContinuationGateBypassDecision(): ContinuationGateDecision {
  return {
    decision: "continue",
    continuationAllowed: true,
    reasonCode: "CONTINUATION_GATE_NOT_CONFIGURED",
    detail: "Continuation gate was not configured for this runtime invocation.",
    requiredChecksPassed: 0,
    requiredChecksTotal: 0,
    requiredChecksPassRatio: 1,
    warningCount: 0,
    maxWarningCount: 0,
    missingFeedbackFields: [],
    failedPolicyAssertionIds: []
  };
}
