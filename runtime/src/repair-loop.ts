import { randomUUID } from "node:crypto";

import {
  SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION,
  SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION
} from "./contracts.ts";
import { createFeedbackTensorEntry, emitFeedbackTensorEntry } from "./feedback-tensor.ts";
import {
  TRACE_INSPECTION_SCHEMA_VERSION,
  emitTraceInspectionEntry,
  emitTraceInspectionReport,
  type TraceInspectionEntryV0
} from "./trace-inspection.ts";

export const REPAIR_FAILURE_CLASSES = [
  "parse",
  "schema_contract",
  "policy_gate",
  "capability_denied",
  "deterministic_runtime",
  "stochastic_extraction_uncertainty"
] as const;

export const REPAIR_STAGES = [
  "compile",
  "contract_load",
  "policy_gate",
  "runtime",
  "extraction"
] as const;

export const REPAIR_ARTIFACTS = [
  "ls_source",
  "semantic_ir",
  "policy_profile",
  "capability_manifest",
  "runtime_event",
  "model_output"
] as const;

export type RepairFailureClass = (typeof REPAIR_FAILURE_CLASSES)[number];
export type RepairStage = (typeof REPAIR_STAGES)[number];
export type RepairArtifact = (typeof REPAIR_ARTIFACTS)[number];
export type RepairDecision = "repaired" | "escalate" | "stop";
export type RepairAttemptOutcome = "repaired" | "retry" | "escalate" | "stop";

export interface RepairLoopInput {
  failureClass: RepairFailureClass;
  stage: RepairStage;
  artifact: RepairArtifact;
  excerpt: string;
}

export interface RunRepairLoopOptions {
  maxAttempts?: number;
  feedbackTensorPath?: string;
  traceInspectionPath?: string;
  traceInspectionReportPath?: string;
  runId?: string;
  traceEntryId?: string;
  now?: () => Date;
  runIdFactory?: () => string;
  feedbackIdFactory?: () => string;
}

export interface RepairAttemptRecord {
  attempt: number;
  ruleId: string;
  outcome: RepairAttemptOutcome;
  reasonCode: string;
  detail: string;
}

export interface RepairLoopResult {
  classification: RepairFailureClass;
  decision: RepairDecision;
  continuationAllowed: boolean;
  reasonCode: string;
  detail: string;
  attempts: number;
  maxAttempts: number;
  appliedRuleId?: string;
  repairedExcerpt?: string;
  history: RepairAttemptRecord[];
}

interface NormalizedRepairLoopInput extends RepairLoopInput {
  excerpt: string;
}

interface RuleMatchContext {
  input: NormalizedRepairLoopInput;
  excerpt: string;
  attempt: number;
}

interface RuleOutcome {
  type: RepairAttemptOutcome;
  reasonCode: string;
  detail: string;
  repairedExcerpt?: string;
  nextExcerpt?: string;
}

interface RepairRule {
  id: string;
  failureClass: RepairFailureClass;
  matches: (context: RuleMatchContext) => boolean;
  apply: (context: RuleMatchContext) => RuleOutcome;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const ABSOLUTE_MAX_ATTEMPTS = 10;
const SCHEMA_VERSION_EXCERPT_PATTERN = /"schema_version"\s*:\s*"([^"]*)"/;
const NUMERIC_LITERAL_PATTERN = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)";
const CONFIDENCE_PATTERN = new RegExp(`confidence=${NUMERIC_LITERAL_PATTERN}`);
const CONFIDENCE_THRESHOLD_PAIR_PATTERN = new RegExp(
  `confidence=${NUMERIC_LITERAL_PATTERN}\\s*;\\s*threshold=${NUMERIC_LITERAL_PATTERN}|threshold=${NUMERIC_LITERAL_PATTERN}\\s*;\\s*confidence=${NUMERIC_LITERAL_PATTERN}`
);
const FALLBACK_PLAN_PATTERN = /fallback_plan=([a-z0-9_]+)(?=;|\s|$)/i;

const EXPECTED_SCHEMA_VERSION_BY_ARTIFACT: Partial<Record<RepairArtifact, string>> = {
  semantic_ir: "0.1.0",
  policy_profile: "0.1.0"
};

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  options: { preserveWhitespace?: boolean } = {}
): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a non-empty string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }

  return options.preserveWhitespace ? value : trimmed;
}

function requireEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string
): T[number] {
  const normalized = requireNonEmptyString(value, path);
  if (!values.includes(normalized)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}; received "${normalized}"`);
  }

  return normalized as T[number];
}

function normalizeRepairLoopInput(input: unknown): NormalizedRepairLoopInput {
  const candidate = requireRecord(input, "repair loop input");

  return {
    failureClass: requireEnumValue(candidate.failureClass, REPAIR_FAILURE_CLASSES, "failureClass"),
    stage: requireEnumValue(candidate.stage, REPAIR_STAGES, "stage"),
    artifact: requireEnumValue(candidate.artifact, REPAIR_ARTIFACTS, "artifact"),
    excerpt: requireNonEmptyString(candidate.excerpt, "excerpt", { preserveWhitespace: true })
  };
}

function normalizeMaxAttempts(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("maxAttempts must be an integer greater than or equal to 1");
  }

  if (value > ABSOLUTE_MAX_ATTEMPTS) {
    throw new Error(`maxAttempts must be less than or equal to ${ABSOLUTE_MAX_ATTEMPTS}`);
  }

  return value;
}

function normalizeOptionalOutputPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createRunIdFallback(): string {
  try {
    const generated = randomUUID();
    const normalized = generated.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  } catch {}

  return `run-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRunId(params: { runId?: string; runIdFactory?: () => string }): string {
  const explicitRunId = normalizeOptionalNonEmptyString(params.runId);
  if (explicitRunId !== undefined) {
    return explicitRunId;
  }

  if (params.runIdFactory) {
    try {
      const generated = params.runIdFactory();
      const normalizedGenerated = normalizeOptionalNonEmptyString(generated);
      if (normalizedGenerated !== undefined) {
        return normalizedGenerated;
      }
    } catch {}
  }

  return createRunIdFallback();
}

function createFeedbackIdFallback(runId: string): string {
  try {
    const generated = randomUUID();
    const normalized = generated.trim();
    if (normalized.length > 0) {
      return `ft-${runId}-${normalized}`;
    }
  } catch {}

  return `ft-${runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveFeedbackId(feedbackIdFactory: () => string, runId: string): string {
  try {
    const generated = feedbackIdFactory();
    const normalizedGenerated = normalizeOptionalNonEmptyString(generated);
    if (normalizedGenerated !== undefined) {
      return normalizedGenerated;
    }
  } catch {}

  return createFeedbackIdFallback(runId);
}

function resolveTimestamp(now: () => Date): string {
  try {
    const candidate = now();
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate.toISOString();
    }
  } catch {}

  return new Date().toISOString();
}

function buildRepairFeedbackConfidence(result: RepairLoopResult): {
  score: number;
  rationale: string;
  calibrationBand: "low" | "medium" | "high";
} {
  if (result.decision === "repaired") {
    return {
      score: 0.9,
      rationale: "Deterministic repair rules produced a policy-safe continuation outcome.",
      calibrationBand: "high"
    };
  }

  if (result.decision === "escalate") {
    return {
      score: 0.45,
      rationale: "No deterministic in-scope repair satisfied safety constraints for continuation.",
      calibrationBand: "medium"
    };
  }

  return {
    score: 0.2,
    rationale: "Repair loop reached an explicit terminal stop condition with continuation blocked.",
    calibrationBand: "low"
  };
}

function buildRepairFeedbackAlternatives(result: RepairLoopResult): Array<{
  id: string;
  hypothesis: string;
  expected_outcome: string;
  estimated_success_probability: number;
}> {
  if (result.decision === "repaired") {
    return [
      {
        id: "alt-continue-with-repair",
        hypothesis: "Proceed using the deterministic repaired payload.",
        expected_outcome: "Execution continues with a bounded, reason-coded repair lineage.",
        estimated_success_probability: 0.9
      },
      {
        id: "alt-manual-verify-repair",
        hypothesis: "Escalate the repaired payload for manual verification before continuation.",
        expected_outcome: "Continuation remains blocked until a reviewer approves the repaired path.",
        estimated_success_probability: 0.98
      }
    ];
  }

  if (result.decision === "escalate") {
    return [
      {
        id: "alt-request-manual-review",
        hypothesis: "Escalate repair decision to a human reviewer.",
        expected_outcome: "Manual adjudication selects an approved remediation path.",
        estimated_success_probability: 0.95
      },
      {
        id: "alt-abort",
        hypothesis: "Abort autonomous continuation for this run.",
        expected_outcome: "System halts unsafe continuation until explicit external intervention.",
        estimated_success_probability: 1
      }
    ];
  }

  return [
    {
      id: "alt-abort",
      hypothesis: "Terminate autonomous continuation immediately.",
      expected_outcome: "No unsafe continuation after terminal stop condition.",
      estimated_success_probability: 1
    },
    {
      id: "alt-manual-postmortem",
      hypothesis: "Route full repair history to human review for postmortem triage.",
      expected_outcome: "Reviewer determines whether to retry externally or leave run terminated.",
      estimated_success_probability: 0.95
    }
  ];
}

function buildRepairFeedbackAction(
  input: NormalizedRepairLoopInput,
  result: RepairLoopResult
): {
  action: "retry_with_patch" | "request_manual_review" | "abort";
  rationale: string;
  requires_human_approval: boolean;
  target: string;
  patch_excerpt?: string;
} {
  if (result.decision === "repaired") {
    return {
      action: "retry_with_patch",
      rationale: result.detail,
      requires_human_approval: false,
      target: `${input.stage}.${input.artifact}`,
      patch_excerpt: result.repairedExcerpt
    };
  }

  if (result.decision === "escalate") {
    return {
      action: "request_manual_review",
      rationale: result.detail,
      requires_human_approval: true,
      target: `${input.stage}.${input.artifact}`
    };
  }

  return {
    action: "abort",
    rationale: result.detail,
    requires_human_approval: false,
    target: `${input.stage}.${input.artifact}`
  };
}

interface RepairFeedbackTensorEmissionResult {
  emitted: boolean;
  feedbackId: string;
  traceEntryId?: string;
  failureSignal: NonNullable<TraceInspectionEntryV0["feedback_tensor"]["failure_signal"]>;
  confidence: NonNullable<TraceInspectionEntryV0["feedback_tensor"]["confidence"]>;
  proposedRepairAction: NonNullable<
    TraceInspectionEntryV0["feedback_tensor"]["proposed_repair_action"]
  >;
}

function emitRepairFeedbackTensor(params: {
  input: NormalizedRepairLoopInput;
  result: RepairLoopResult;
  feedbackTensorPath: string;
  runId: string;
  now: () => Date;
  feedbackIdFactory: () => string;
  traceEntryId?: string;
}): RepairFeedbackTensorEmissionResult {
  const confidence = buildRepairFeedbackConfidence(params.result);
  const action = buildRepairFeedbackAction(params.input, params.result);
  const feedbackId = resolveFeedbackId(params.feedbackIdFactory, params.runId);
  const entry = createFeedbackTensorEntry({
    feedbackId,
    generatedAt: resolveTimestamp(params.now),
    failureSignal: {
      class: params.result.classification,
      stage: "repair",
      summary: params.result.detail,
      continuationAllowed: params.result.continuationAllowed,
      errorCode: params.result.reasonCode
    },
    confidence: {
      score: confidence.score,
      rationale: confidence.rationale,
      calibrationBand: confidence.calibrationBand
    },
    alternatives: buildRepairFeedbackAlternatives(params.result),
    proposedRepairAction: action,
    provenance: {
      runId: params.runId,
      sourceStage: "repair_loop",
      traceEntryId: params.traceEntryId,
      contractVersions: {
        semanticIr: SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION,
        policyProfile: SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION
      }
    }
  });

  try {
    emitFeedbackTensorEntry(entry, { outputPath: params.feedbackTensorPath });
    return {
      emitted: true,
      feedbackId,
      traceEntryId: entry.provenance.trace_entry_id,
      failureSignal: {
        class: entry.failure_signal.class,
        stage: entry.failure_signal.stage,
        continuation_allowed: entry.failure_signal.continuation_allowed,
        error_code: entry.failure_signal.error_code
      },
      confidence: {
        score: entry.confidence.score,
        rationale: entry.confidence.rationale,
        calibration_band: entry.confidence.calibration_band
      },
      proposedRepairAction: {
        action: entry.proposed_repair_action.action,
        requires_human_approval: entry.proposed_repair_action.requires_human_approval,
        target: entry.proposed_repair_action.target
      }
    };
  } catch {}

  return {
    emitted: false,
    feedbackId,
    traceEntryId: entry.provenance.trace_entry_id,
    failureSignal: {
      class: entry.failure_signal.class,
      stage: entry.failure_signal.stage,
      continuation_allowed: entry.failure_signal.continuation_allowed,
      error_code: entry.failure_signal.error_code
    },
    confidence: {
      score: entry.confidence.score,
      rationale: entry.confidence.rationale,
      calibration_band: entry.confidence.calibration_band
    },
    proposedRepairAction: {
      action: entry.proposed_repair_action.action,
      requires_human_approval: entry.proposed_repair_action.requires_human_approval,
      target: entry.proposed_repair_action.target
    }
  };
}

function emitRepairTraceInspection(params: {
  runId: string;
  traceEntryId?: string;
  startedAt: string;
  completedAt: string;
  feedbackTensorPath?: string;
  feedbackTensorEmission?: RepairFeedbackTensorEmissionResult;
  traceInspectionPath?: string;
  traceInspectionReportPath?: string;
  result: RepairLoopResult;
}): void {
  if (!params.traceInspectionPath && !params.traceInspectionReportPath) {
    return;
  }

  const entry: TraceInspectionEntryV0 = {
    schema_version: TRACE_INSPECTION_SCHEMA_VERSION,
    run_id: params.runId,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    generated_at: params.completedAt,
    invocation:
      params.result.decision === "repaired"
        ? {
            status: "success",
            trace_id: params.traceEntryId ?? `repair-${params.runId}`
          }
        : {
            status: "failure",
            failure_code: params.result.reasonCode,
            error: {
              name: "RepairLoopDecisionError",
              message: params.result.detail
            }
          },
    repair: {
      decision: params.result.decision,
      continuation_allowed: params.result.continuationAllowed,
      reason_code: params.result.reasonCode,
      detail: params.result.detail,
      attempts: params.result.attempts,
      max_attempts: params.result.maxAttempts,
      applied_rule_id: params.result.appliedRuleId,
      repaired_excerpt: params.result.repairedExcerpt,
      history: params.result.history.map((record) => ({
        attempt: record.attempt,
        rule_id: record.ruleId,
        outcome: record.outcome,
        reason_code: record.reasonCode,
        detail: record.detail
      }))
    },
    trace_ledger: {
      configured: params.traceEntryId !== undefined,
      emitted: false,
      trace_entry_id: params.traceEntryId
    },
    feedback_tensor: {
      configured: params.feedbackTensorPath !== undefined,
      emitted: params.feedbackTensorEmission?.emitted ?? false,
      output_path: params.feedbackTensorPath,
      feedback_id: params.feedbackTensorEmission?.feedbackId,
      trace_entry_id: params.feedbackTensorEmission?.traceEntryId ?? params.traceEntryId,
      failure_signal: params.feedbackTensorEmission?.failureSignal,
      confidence: params.feedbackTensorEmission?.confidence,
      proposed_repair_action: params.feedbackTensorEmission?.proposedRepairAction
    }
  };

  if (params.traceInspectionPath) {
    try {
      emitTraceInspectionEntry(entry, { outputPath: params.traceInspectionPath });
    } catch {}
  }

  if (params.traceInspectionReportPath) {
    try {
      emitTraceInspectionReport(entry, { outputPath: params.traceInspectionReportPath });
    } catch {}
  }
}

function getSchemaVersionFromExcerpt(excerpt: string): string | undefined {
  const match = SCHEMA_VERSION_EXCERPT_PATTERN.exec(excerpt);
  return match?.[1];
}

function replaceSchemaVersionInExcerpt(excerpt: string, version: string): string {
  return excerpt.replace(SCHEMA_VERSION_EXCERPT_PATTERN, `"schema_version": "${version}"`);
}

function parseConfidenceTuple(
  excerpt: string
):
  | {
      confidence: number;
      threshold: number;
      confidenceLiteral: string;
      thresholdLiteral: string;
      pairStart: number;
      pairEnd: number;
    }
  | undefined {
  const tupleMatch = CONFIDENCE_THRESHOLD_PAIR_PATTERN.exec(excerpt);
  if (!tupleMatch) {
    return undefined;
  }

  const confidenceLiteral = tupleMatch[1] ?? tupleMatch[4];
  const thresholdLiteral = tupleMatch[2] ?? tupleMatch[3];
  if (confidenceLiteral === undefined || thresholdLiteral === undefined) {
    return undefined;
  }

  const confidence = Number.parseFloat(confidenceLiteral);
  const threshold = Number.parseFloat(thresholdLiteral);
  if (!Number.isFinite(confidence) || !Number.isFinite(threshold)) {
    return undefined;
  }

  return {
    confidence,
    threshold,
    confidenceLiteral,
    thresholdLiteral,
    pairStart: tupleMatch.index,
    pairEnd: tupleMatch.index + tupleMatch[0].length
  };
}

function replaceConfidenceInExcerpt(
  excerpt: string,
  tuple: {
    pairStart: number;
    pairEnd: number;
  },
  confidenceLiteral: string
): string {
  const tupleExcerpt = excerpt.slice(tuple.pairStart, tuple.pairEnd);
  const repairedTupleExcerpt = tupleExcerpt.replace(CONFIDENCE_PATTERN, `confidence=${confidenceLiteral}`);
  return `${excerpt.slice(0, tuple.pairStart)}${repairedTupleExcerpt}${excerpt.slice(tuple.pairEnd)}`;
}

const REPAIR_RULES: RepairRule[] = [
  {
    id: "parse.append_missing_goal_quote",
    failureClass: "parse",
    matches: (context) =>
      context.input.stage === "compile" &&
      context.input.artifact === "ls_source" &&
      context.excerpt.startsWith('goal "') &&
      !context.excerpt.endsWith('"') &&
      context.excerpt.length > 'goal "'.length,
    apply: (context) => ({
      type: "repaired",
      reasonCode: "PARSE_APPEND_MISSING_QUOTE",
      detail: "Appended missing closing quote in goal declaration.",
      repairedExcerpt: `${context.excerpt}"`
    })
  },
  {
    id: "parse.truncated_context",
    failureClass: "parse",
    matches: (context) =>
      context.input.stage === "compile" &&
      context.input.artifact === "ls_source" &&
      context.excerpt === 'goal "',
    apply: () => ({
      type: "escalate",
      reasonCode: "PARSE_TRUNCATED_CONTEXT",
      detail: "Source is truncated and cannot be deterministically repaired."
    })
  },
  {
    id: "schema_contract.normalize_schema_version_whitespace",
    failureClass: "schema_contract",
    matches: (context) => {
      if (context.input.stage !== "contract_load") {
        return false;
      }
      if (context.input.artifact !== "semantic_ir" && context.input.artifact !== "policy_profile") {
        return false;
      }

      const extractedVersion = getSchemaVersionFromExcerpt(context.excerpt);
      if (extractedVersion === undefined) {
        return false;
      }

      const normalizedVersion = extractedVersion.trim();
      if (normalizedVersion === extractedVersion) {
        return false;
      }

      return normalizedVersion === EXPECTED_SCHEMA_VERSION_BY_ARTIFACT[context.input.artifact];
    },
    apply: (context) => {
      const extractedVersion = getSchemaVersionFromExcerpt(context.excerpt);
      const normalizedVersion = extractedVersion?.trim() ?? "";
      return {
        type: "repaired",
        reasonCode: "SCHEMA_VERSION_WHITESPACE_NORMALIZED",
        detail: "Normalized schema_version whitespace to expected canonical version.",
        repairedExcerpt: replaceSchemaVersionInExcerpt(context.excerpt, normalizedVersion)
      };
    }
  },
  {
    id: "schema_contract.reject_incompatible_schema_version",
    failureClass: "schema_contract",
    matches: (context) => {
      if (context.input.stage !== "contract_load") {
        return false;
      }
      if (context.input.artifact !== "semantic_ir" && context.input.artifact !== "policy_profile") {
        return false;
      }

      const extractedVersion = getSchemaVersionFromExcerpt(context.excerpt);
      if (extractedVersion === undefined) {
        return false;
      }

      const normalizedVersion = extractedVersion.trim();
      const expectedVersion = EXPECTED_SCHEMA_VERSION_BY_ARTIFACT[context.input.artifact];
      if (expectedVersion === undefined) {
        return false;
      }

      if (normalizedVersion === expectedVersion) {
        return false;
      }

      return true;
    },
    apply: () => ({
      type: "escalate",
      reasonCode: "SCHEMA_VERSION_INCOMPATIBLE",
      detail: "Schema version is incompatible with supported runtime contracts."
    })
  },
  {
    id: "policy_gate.apply_budget_fallback_plan",
    failureClass: "policy_gate",
    matches: (context) =>
      context.input.stage === "policy_gate" &&
      context.input.artifact === "policy_profile" &&
      context.excerpt.includes("max_tokens exceeded") &&
      context.excerpt.includes("fallback_plan="),
    apply: (context) => {
      const fallbackMatch = FALLBACK_PLAN_PATTERN.exec(context.excerpt);
      if (!fallbackMatch) {
        return {
          type: "escalate",
          reasonCode: "POLICY_FALLBACK_PLAN_UNPARSEABLE",
          detail: "Policy fallback plan could not be deterministically identified."
        };
      }

      const fallbackPlan = fallbackMatch[1];
      return {
        type: "repaired",
        reasonCode: "POLICY_FALLBACK_PLAN_APPLIED",
        detail: `Applied deterministic policy fallback "${fallbackPlan}".`,
        repairedExcerpt: `${context.excerpt}; selected_fallback=${fallbackPlan}`
      };
    }
  },
  {
    id: "policy_gate.terminal_deny_production_destructive_write",
    failureClass: "policy_gate",
    matches: (context) =>
      context.input.stage === "policy_gate" &&
      context.input.artifact === "policy_profile" &&
      context.excerpt.includes("action=delete_resource") &&
      context.excerpt.includes("environment=production") &&
      context.excerpt.includes("rule=deny"),
    apply: () => ({
      type: "stop",
      reasonCode: "POLICY_DENY_TERMINAL",
      detail: "Production policy denies destructive action with no safe autonomous continuation."
    })
  },
  {
    id: "capability_denied.downgrade_to_readonly_flow",
    failureClass: "capability_denied",
    matches: (context) =>
      context.input.stage === "runtime" &&
      context.input.artifact === "capability_manifest" &&
      context.excerpt.includes("requested=filesystem.write") &&
      context.excerpt.includes("available=filesystem.read"),
    apply: (context) => ({
      type: "repaired",
      reasonCode: "CAPABILITY_DOWNGRADED_TO_READONLY",
      detail: "Switched from write operation to read-only inspection fallback.",
      repairedExcerpt: context.excerpt.replace(
        "requested=filesystem.write",
        "requested=filesystem.read"
      )
    })
  },
  {
    id: "capability_denied.required_network_capability_missing",
    failureClass: "capability_denied",
    matches: (context) =>
      context.input.stage === "runtime" &&
      context.input.artifact === "capability_manifest" &&
      context.excerpt.includes("requested=network.http") &&
      context.excerpt.includes("available=[]"),
    apply: () => ({
      type: "escalate",
      reasonCode: "CAPABILITY_NETWORK_REQUIRED",
      detail: "Required network capability is unavailable and no deterministic offline fallback exists."
    })
  },
  {
    id: "deterministic_runtime.retry_timeout_then_recover",
    failureClass: "deterministic_runtime",
    matches: (context) =>
      context.input.stage === "runtime" &&
      context.input.artifact === "runtime_event" &&
      context.excerpt.includes("error=timeout") &&
      context.excerpt.includes("retryable=true"),
    apply: (context) => {
      if (context.attempt < 2) {
        return {
          type: "retry",
          reasonCode: "DETERMINISTIC_TIMEOUT_RETRY",
          detail: "Retryable deterministic timeout encountered; retrying with bounded attempt budget."
        };
      }

      return {
        type: "repaired",
        reasonCode: "DETERMINISTIC_TIMEOUT_RECOVERED",
        detail: "Deterministic timeout recovered within bounded retries.",
        repairedExcerpt: context.excerpt
          .replace("error=timeout", "error=none")
          .replace("retryable=true", "retryable=false")
      };
    }
  },
  {
    id: "deterministic_runtime.terminal_invariant_violation",
    failureClass: "deterministic_runtime",
    matches: (context) =>
      context.input.stage === "runtime" &&
      context.input.artifact === "runtime_event" &&
      context.excerpt.includes("node_output missing for required dependency"),
    apply: () => ({
      type: "stop",
      reasonCode: "DETERMINISTIC_INVARIANT_VIOLATION",
      detail: "Deterministic runtime invariant is violated; state cannot be safely continued."
    })
  },
  {
    id: "stochastic_extraction_uncertainty.reprompt_to_raise_confidence",
    failureClass: "stochastic_extraction_uncertainty",
    matches: (context) => {
      if (context.input.stage !== "extraction" || context.input.artifact !== "model_output") {
        return false;
      }

      const tuple = parseConfidenceTuple(context.excerpt);
      if (tuple === undefined) {
        return false;
      }

      return tuple.confidence < tuple.threshold;
    },
    apply: (context) => {
      const tuple = parseConfidenceTuple(context.excerpt);
      if (tuple === undefined) {
        return {
          type: "escalate",
          reasonCode: "STOCHASTIC_CONFIDENCE_TUPLE_MISSING",
          detail: "Confidence and threshold tuple could not be parsed for deterministic repair."
        };
      }

      if (context.attempt < 2) {
        return {
          type: "retry",
          reasonCode: "STOCHASTIC_REPROMPT_REQUIRED",
          detail: "Confidence below threshold; issuing constrained deterministic re-prompt."
        };
      }

      return {
        type: "repaired",
        reasonCode: "STOCHASTIC_CONFIDENCE_RECOVERED",
        detail: "Confidence repaired to threshold using constrained deterministic re-prompting.",
        repairedExcerpt: replaceConfidenceInExcerpt(context.excerpt, tuple, tuple.thresholdLiteral)
      };
    }
  },
  {
    id: "stochastic_extraction_uncertainty.ambiguous_entity_unresolved",
    failureClass: "stochastic_extraction_uncertainty",
    matches: (context) =>
      context.input.stage === "extraction" &&
      context.input.artifact === "model_output" &&
      context.excerpt.includes("top_candidates overlap") &&
      context.excerpt.includes("confidence delta < 0.02"),
    apply: () => ({
      type: "retry",
      reasonCode: "STOCHASTIC_AMBIGUITY_RETRY",
      detail: "Entity ambiguity remains unresolved after constrained deterministic retry."
    })
  }
];

export const RULE_FIRST_REPAIR_ORDER = REPAIR_RULES.map((rule) => rule.id);

function createTerminalResult(params: {
  input: NormalizedRepairLoopInput;
  maxAttempts: number;
  decision: RepairDecision;
  reasonCode: string;
  detail: string;
  attempts: number;
  history: RepairAttemptRecord[];
  appliedRuleId?: string;
  repairedExcerpt?: string;
}): RepairLoopResult {
  return {
    classification: params.input.failureClass,
    decision: params.decision,
    continuationAllowed: params.decision === "repaired",
    reasonCode: params.reasonCode,
    detail: params.detail,
    attempts: params.attempts,
    maxAttempts: params.maxAttempts,
    history: params.history,
    appliedRuleId: params.appliedRuleId,
    repairedExcerpt: params.repairedExcerpt
  };
}

export function runRuleFirstRepairLoop(
  input: RepairLoopInput,
  options: RunRepairLoopOptions = {}
): RepairLoopResult {
  const normalizedInput = normalizeRepairLoopInput(input);
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const orderedRules = REPAIR_RULES.filter((rule) => rule.failureClass === normalizedInput.failureClass);
  const history: RepairAttemptRecord[] = [];
  const now = options.now ?? (() => new Date());
  const feedbackTensorPath = normalizeOptionalOutputPath(options.feedbackTensorPath);
  const traceInspectionPath = normalizeOptionalOutputPath(options.traceInspectionPath);
  const traceInspectionReportPath = normalizeOptionalOutputPath(options.traceInspectionReportPath);
  const shouldEmitTraceInspection =
    traceInspectionPath !== undefined || traceInspectionReportPath !== undefined;
  const shouldResolveRunContext = feedbackTensorPath !== undefined || shouldEmitTraceInspection;
  const runId = shouldResolveRunContext
    ? resolveRunId({
        runId: options.runId,
        runIdFactory: options.runIdFactory
      })
    : "";
  const traceEntryId = normalizeOptionalNonEmptyString(options.traceEntryId);
  const startedAt = shouldEmitTraceInspection ? resolveTimestamp(now) : "";
  const feedbackContext = (() => {
    if (feedbackTensorPath === undefined) {
      return undefined;
    }

    return {
      feedbackTensorPath,
      runId,
      now,
      feedbackIdFactory: options.feedbackIdFactory ?? (() => createFeedbackIdFallback(runId)),
      traceEntryId
    };
  })();

  const createResult = (params: {
    input: NormalizedRepairLoopInput;
    maxAttempts: number;
    decision: RepairDecision;
    reasonCode: string;
    detail: string;
    attempts: number;
    history: RepairAttemptRecord[];
    appliedRuleId?: string;
    repairedExcerpt?: string;
  }): RepairLoopResult => {
    const result = createTerminalResult(params);
    const completedAt = shouldEmitTraceInspection ? resolveTimestamp(now) : "";
    const feedbackTensorEmission = feedbackContext
      ? emitRepairFeedbackTensor({
          input: normalizedInput,
          result,
          feedbackTensorPath: feedbackContext.feedbackTensorPath,
          runId: feedbackContext.runId,
          now: feedbackContext.now,
          feedbackIdFactory: feedbackContext.feedbackIdFactory,
          traceEntryId: feedbackContext.traceEntryId
        })
      : undefined;

    emitRepairTraceInspection({
      runId,
      traceEntryId,
      startedAt,
      completedAt,
      feedbackTensorPath,
      feedbackTensorEmission,
      traceInspectionPath,
      traceInspectionReportPath,
      result
    });

    return result;
  };

  if (orderedRules.length === 0) {
    return createResult({
      input: normalizedInput,
      maxAttempts,
      decision: "escalate",
      reasonCode: "NO_RULES_REGISTERED",
      detail: `No deterministic repair rules are registered for failure class "${normalizedInput.failureClass}".`,
      attempts: 0,
      history
    });
  }

  let excerpt = normalizedInput.excerpt;

  attemptLoop: for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let matchedRule = false;

    for (const rule of orderedRules) {
      const context: RuleMatchContext = {
        input: normalizedInput,
        excerpt,
        attempt
      };

      if (!rule.matches(context)) {
        continue;
      }

      matchedRule = true;
      const outcome = rule.apply(context);
      history.push({
        attempt,
        ruleId: rule.id,
        outcome: outcome.type,
        reasonCode: outcome.reasonCode,
        detail: outcome.detail
      });

      if (outcome.type === "retry") {
        if (outcome.nextExcerpt !== undefined) {
          excerpt = outcome.nextExcerpt;
        }

        if (attempt === maxAttempts) {
          return createResult({
            input: normalizedInput,
            maxAttempts,
            decision: "stop",
            reasonCode: "MAX_ATTEMPTS_EXCEEDED",
            detail: `Maximum retry attempts reached (${maxAttempts}) after ${outcome.reasonCode}.`,
            attempts: attempt,
            history,
            appliedRuleId: rule.id
          });
        }

        continue attemptLoop;
      }

      if (outcome.type === "repaired") {
        return createResult({
          input: normalizedInput,
          maxAttempts,
          decision: "repaired",
          reasonCode: outcome.reasonCode,
          detail: outcome.detail,
          attempts: attempt,
          history,
          appliedRuleId: rule.id,
          repairedExcerpt: outcome.repairedExcerpt ?? excerpt
        });
      }

      return createResult({
        input: normalizedInput,
        maxAttempts,
        decision: outcome.type,
        reasonCode: outcome.reasonCode,
        detail: outcome.detail,
        attempts: attempt,
        history,
        appliedRuleId: rule.id
      });
    }

    if (!matchedRule) {
      return createResult({
        input: normalizedInput,
        maxAttempts,
        decision: "escalate",
        reasonCode: "NO_SAFE_DETERMINISTIC_REPAIR",
        detail: "No deterministic repair rule matched this failure payload safely.",
        attempts: attempt,
        history
      });
    }
  }

  return createResult({
    input: normalizedInput,
    maxAttempts,
    decision: "stop",
    reasonCode: "MAX_ATTEMPTS_EXCEEDED",
    detail: `Maximum retry attempts reached (${maxAttempts}).`,
    attempts: maxAttempts,
    history
  });
}
