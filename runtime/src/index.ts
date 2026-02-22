import { randomUUID } from "node:crypto";

import {
  ContractValidationError,
  SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION,
  SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION
} from "./contracts.ts";
import {
  TRACE_LEDGER_SCHEMA_VERSION,
  emitTraceLedgerEntry,
  type TraceLedgerEntryV0,
  type TraceLedgerError
} from "./trace-ledger.ts";
import {
  createFeedbackTensorEntry,
  emitFeedbackTensorEntry,
  type FeedbackTensorFailureClass
} from "./feedback-tensor.ts";
import {
  createContinuationGateBypassDecision,
  evaluateContinuationGate,
  type ContinuationGateDecision,
  type ContinuationGateReasonCode,
  type EvaluateContinuationGateInput
} from "./continuation-gate.ts";
import {
  TRACE_INSPECTION_SCHEMA_VERSION,
  emitTraceInspectionEntry,
  emitTraceInspectionReport,
  type TraceInspectionEntryV0
} from "./trace-inspection.ts";

export interface SemanticIrEnvelope {
  version: string;
  goal: string;
}

export interface RuntimeResult {
  ok: true;
  traceId: string;
  continuationDecision: ContinuationGateDecision;
}

export interface RunSemanticIrOptions {
  traceLedgerPath?: string;
  feedbackTensorPath?: string;
  traceInspectionPath?: string;
  traceInspectionReportPath?: string;
  continuationGate?: EvaluateContinuationGateInput;
  now?: () => Date;
  runIdFactory?: () => string;
  feedbackIdFactory?: () => string;
}

type RuntimeSemanticIrValidationCode =
  | "SEMANTIC_IR_INPUT_INVALID"
  | "SEMANTIC_IR_VERSION_REQUIRED"
  | "SEMANTIC_IR_GOAL_REQUIRED";

class RuntimeSemanticIrValidationError extends Error {
  readonly code: RuntimeSemanticIrValidationCode;
  readonly failureClass: FeedbackTensorFailureClass;

  constructor(message: string, code: RuntimeSemanticIrValidationCode) {
    super(message);
    this.name = "Error";
    this.code = code;
    this.failureClass = "schema_contract";
  }
}

function resolveContinuationGateFailureClass(
  reasonCode: ContinuationGateReasonCode
): FeedbackTensorFailureClass {
  if (
    reasonCode === "POLICY_PROFILE_REQUIRED" ||
    reasonCode === "VERIFICATION_POLICY_ASSERTION_FAILED"
  ) {
    return "policy_gate";
  }

  return "deterministic_runtime";
}

export class RuntimeContinuationGateError extends Error {
  readonly code: ContinuationGateReasonCode;
  readonly decision: ContinuationGateDecision["decision"];
  readonly failureClass: FeedbackTensorFailureClass;

  constructor(decision: ContinuationGateDecision) {
    super(
      `Continuation gate returned "${decision.decision}" with reason "${decision.reasonCode}". Autonomous continuation is blocked.`
    );
    this.name = "Error";
    this.code = decision.reasonCode;
    this.decision = decision.decision;
    this.failureClass = resolveContinuationGateFailureClass(decision.reasonCode);
  }
}

function requireNonEmptyString(
  value: unknown,
  message: string,
  validationCode?: RuntimeSemanticIrValidationCode
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (validationCode !== undefined) {
      throw new RuntimeSemanticIrValidationError(message, validationCode);
    }
    throw new Error(message);
  }

  return value.trim();
}

function toTraceLedgerError(error: unknown): TraceLedgerError {
  if (error instanceof Error) {
    const normalizedErrorName = error.name.trim();
    return {
      name: normalizedErrorName.length > 0 ? normalizedErrorName : "Error",
      message: error.message
    };
  }

  let message = "[unstringifiable thrown value]";
  try {
    message = String(error);
  } catch {}

  return {
    name: "NonErrorThrown",
    message
  };
}

function normalizeOutputPath(outputPath?: string): string | undefined {
  if (typeof outputPath !== "string") {
    return undefined;
  }

  const trimmed = outputPath.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createTraceRunIdFallback(): string {
  try {
    const generated = randomUUID();
    const normalized = generated.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  } catch {}

  return `run-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveTraceRunId(runIdFactory: () => string): string {
  try {
    const rawRunId = runIdFactory();
    if (typeof rawRunId === "string") {
      const normalizedRunId = rawRunId.trim();
      if (normalizedRunId.length > 0) {
        return normalizedRunId;
      }
    }
  } catch {}

  return createTraceRunIdFallback();
}

function createFeedbackIdFallback(): string {
  try {
    const generated = randomUUID();
    const normalized = generated.trim();
    if (normalized.length > 0) {
      return `ft-${normalized}`;
    }
  } catch {}

  return `ft-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveFeedbackId(feedbackIdFactory: () => string): string {
  try {
    const rawFeedbackId = feedbackIdFactory();
    if (typeof rawFeedbackId === "string") {
      const normalizedFeedbackId = rawFeedbackId.trim();
      if (normalizedFeedbackId.length > 0) {
        return normalizedFeedbackId;
      }
    }
  } catch {}

  return createFeedbackIdFallback();
}

function resolveTraceTimestamp(now: () => Date): string {
  try {
    const candidate = now();
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate.toISOString();
    }
  } catch {}

  return new Date().toISOString();
}

function resolveRuntimeFailureClass(error: unknown): FeedbackTensorFailureClass {
  if (error instanceof RuntimeSemanticIrValidationError) {
    return error.failureClass;
  }

  if (error instanceof RuntimeContinuationGateError) {
    return error.failureClass;
  }

  if (error instanceof ContractValidationError) {
    return "schema_contract";
  }

  return "deterministic_runtime";
}

interface RuntimeFeedbackTensorEmissionResult {
  emitted: boolean;
  feedbackId: string;
  traceEntryId?: string;
  failureSignal: NonNullable<TraceInspectionEntryV0["feedback_tensor"]["failure_signal"]>;
  confidence: NonNullable<TraceInspectionEntryV0["feedback_tensor"]["confidence"]>;
  proposedRepairAction: NonNullable<
    TraceInspectionEntryV0["feedback_tensor"]["proposed_repair_action"]
  >;
}

function emitRuntimeFailureFeedbackTensor(params: {
  runId: string;
  generatedAt: string;
  feedbackTensorPath?: string;
  feedbackIdFactory: () => string;
  failureClass: FeedbackTensorFailureClass;
  errorCode: string;
  error: TraceLedgerError;
  traceEntryId?: string;
}): RuntimeFeedbackTensorEmissionResult | undefined {
  if (!params.feedbackTensorPath) {
    return undefined;
  }

  const feedbackId = resolveFeedbackId(params.feedbackIdFactory);
  const entry = createFeedbackTensorEntry({
    feedbackId,
    generatedAt: params.generatedAt,
    failureSignal: {
      class: params.failureClass,
      stage: "runtime",
      summary: params.error.message,
      continuationAllowed: false,
      errorCode: params.errorCode
    },
    confidence: {
      score: params.failureClass === "schema_contract" ? 0.9 : 0.7,
      rationale:
        params.failureClass === "schema_contract"
          ? "Input validation indicates a contract-shape violation before autonomous continuation."
          : "Runtime invocation failed with a deterministic local error signal.",
      calibrationBand: params.failureClass === "schema_contract" ? "high" : "medium"
    },
    alternatives: [
      {
        id: "alt-deterministic-repair",
        hypothesis: "Run deterministic repair workflow over the failure payload.",
        expected_outcome: "Known failure classes can be auto-repaired without unsafe continuation.",
        estimated_success_probability: params.failureClass === "schema_contract" ? 0.8 : 0.65
      },
      {
        id: "alt-manual-review",
        hypothesis: "Escalate failure details to a human reviewer.",
        expected_outcome: "Continuation remains blocked until manual remediation is approved.",
        estimated_success_probability: 0.95
      }
    ],
    proposedRepairAction: {
      action: "retry_with_patch",
      rationale:
        "Attempt deterministic repair-loop recovery before any policy-gated escalation path is chosen.",
      requires_human_approval: false,
      target: params.failureClass === "schema_contract" ? "semantic_ir.contract" : "runtime.invocation"
    },
    provenance: {
      runId: params.runId,
      sourceStage: "runtime",
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

function emitRuntimeTraceLedger(params: {
  runId: string;
  startedAt: string;
  completedAt: string;
  traceLedgerPath?: string;
  error?: TraceLedgerError;
}): boolean {
  if (!params.traceLedgerPath) {
    return false;
  }

  const ledgerEntry: TraceLedgerEntryV0 = {
    schema_version: TRACE_LEDGER_SCHEMA_VERSION,
    run_id: params.runId,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    contract_versions: {
      semantic_ir: SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION,
      policy_profile: SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION
    },
    outcome:
      params.error === undefined
        ? {
            status: "success"
          }
        : {
            status: "failure",
            error: params.error
          }
  };

  try {
    emitTraceLedgerEntry(ledgerEntry, { outputPath: params.traceLedgerPath });
    return true;
  } catch {}

  return false;
}

function resolveRuntimeFailureCode(error: unknown, traceError: TraceLedgerError): string {
  if (error instanceof RuntimeSemanticIrValidationError) {
    return error.code;
  }

  if (error instanceof RuntimeContinuationGateError) {
    return error.code;
  }

  if (error instanceof ContractValidationError) {
    return error.code;
  }

  return traceError.name;
}

function emitRuntimeTraceInspection(params: {
  runId: string;
  startedAt: string;
  completedAt: string;
  generatedAt: string;
  traceId?: string;
  error?: TraceLedgerError;
  failureCode: string;
  continuationDecision: ContinuationGateDecision;
  traceLedgerPath?: string;
  traceLedgerWritten: boolean;
  feedbackTensorPath?: string;
  feedbackTensorEmission?: RuntimeFeedbackTensorEmissionResult;
  traceInspectionPath?: string;
  traceInspectionReportPath?: string;
}): void {
  if (!params.traceInspectionPath && !params.traceInspectionReportPath) {
    return;
  }

  const entry: TraceInspectionEntryV0 = {
    schema_version: TRACE_INSPECTION_SCHEMA_VERSION,
    run_id: params.runId,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    generated_at: params.generatedAt,
    invocation:
      params.error === undefined
        ? {
            status: "success",
            trace_id: params.traceId ?? "trace-unavailable"
          }
        : {
            status: "failure",
            failure_code: params.failureCode,
            error: params.error
          },
    continuation_gate: {
      configured: params.continuationDecision.reasonCode !== "CONTINUATION_GATE_NOT_CONFIGURED",
      decision: params.continuationDecision.decision,
      continuation_allowed: params.continuationDecision.continuationAllowed,
      reason_code: params.continuationDecision.reasonCode,
      detail: params.continuationDecision.detail
    },
    trace_ledger: {
      configured: params.traceLedgerPath !== undefined,
      emitted: params.traceLedgerWritten,
      output_path: params.traceLedgerPath,
      trace_entry_id: params.traceLedgerWritten ? params.runId : undefined
    },
    feedback_tensor: {
      configured: params.feedbackTensorPath !== undefined,
      emitted: params.feedbackTensorEmission?.emitted ?? false,
      output_path: params.feedbackTensorPath,
      feedback_id: params.feedbackTensorEmission?.feedbackId,
      trace_entry_id: params.feedbackTensorEmission?.traceEntryId,
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

export function runSemanticIr(ir: SemanticIrEnvelope, options: RunSemanticIrOptions = {}): RuntimeResult {
  const now = options.now ?? (() => new Date());
  const runIdFactory = options.runIdFactory ?? (() => randomUUID());
  const feedbackIdFactory = options.feedbackIdFactory ?? (() => createFeedbackIdFallback());
  const traceLedgerPath = normalizeOutputPath(options.traceLedgerPath);
  const feedbackTensorPath = normalizeOutputPath(options.feedbackTensorPath);
  const traceInspectionPath = normalizeOutputPath(options.traceInspectionPath);
  const traceInspectionReportPath = normalizeOutputPath(options.traceInspectionReportPath);
  const shouldEmitTraceInspection =
    traceInspectionPath !== undefined || traceInspectionReportPath !== undefined;

  const shouldResolveRunContext =
    traceLedgerPath !== undefined || feedbackTensorPath !== undefined || shouldEmitTraceInspection;
  const runId = shouldResolveRunContext ? resolveTraceRunId(runIdFactory) : "";
  const startedAt =
    traceLedgerPath !== undefined || shouldEmitTraceInspection ? resolveTraceTimestamp(now) : "";

  let invocationTraceId = "";
  let invocationError: TraceLedgerError | undefined;
  let invocationFailureClass: FeedbackTensorFailureClass = "deterministic_runtime";
  let invocationFailureCode = "RUNTIME_INVOCATION_ERROR";
  let continuationDecision = createContinuationGateBypassDecision();
  try {
    if (typeof ir !== "object" || ir === null || Array.isArray(ir)) {
      throw new RuntimeSemanticIrValidationError(
        "SemanticIR input must be an object",
        "SEMANTIC_IR_INPUT_INVALID"
      );
    }

    const version = requireNonEmptyString(
      (ir as { version?: unknown }).version,
      "SemanticIR version is required",
      "SEMANTIC_IR_VERSION_REQUIRED"
    );
    requireNonEmptyString(
      (ir as { goal?: unknown }).goal,
      "SemanticIR goal is required",
      "SEMANTIC_IR_GOAL_REQUIRED"
    );

    continuationDecision = options.continuationGate
      ? evaluateContinuationGate(options.continuationGate)
      : createContinuationGateBypassDecision();
    if (continuationDecision.decision !== "continue") {
      throw new RuntimeContinuationGateError(continuationDecision);
    }

    invocationTraceId = `trace-${version}`;
    return {
      ok: true,
      traceId: invocationTraceId,
      continuationDecision
    };
  } catch (error) {
    invocationError = toTraceLedgerError(error);
    invocationFailureClass = resolveRuntimeFailureClass(error);
    invocationFailureCode = resolveRuntimeFailureCode(error, invocationError);
    throw error;
  } finally {
    const completedAt = shouldResolveRunContext ? resolveTraceTimestamp(now) : "";
    const traceLedgerWritten = traceLedgerPath
      ? emitRuntimeTraceLedger({
          runId,
          startedAt,
          completedAt,
          traceLedgerPath,
          error: invocationError
        })
      : false;

    const feedbackTensorEmission =
      feedbackTensorPath && invocationError
        ? emitRuntimeFailureFeedbackTensor({
            runId,
            generatedAt: completedAt,
            feedbackTensorPath,
            feedbackIdFactory,
            failureClass: invocationFailureClass,
            errorCode: invocationFailureCode,
            error: invocationError,
            traceEntryId: traceLedgerWritten ? runId : undefined
          })
        : undefined;

    emitRuntimeTraceInspection({
      runId,
      startedAt,
      completedAt,
      generatedAt: completedAt,
      traceId: invocationTraceId,
      error: invocationError,
      failureCode: invocationFailureCode,
      continuationDecision,
      traceLedgerPath,
      traceLedgerWritten,
      feedbackTensorPath,
      feedbackTensorEmission,
      traceInspectionPath,
      traceInspectionReportPath
    });
  }
}

export {
  CONTINUATION_DECISIONS,
  CONTINUATION_GATE_REASON_CODES,
  createContinuationGateBypassDecision,
  evaluateContinuationGate,
  type ContinuationDecision,
  type ContinuationGateDecision,
  type ContinuationGateReasonCode,
  type EvaluateContinuationGateInput,
  type VerificationCheckResult,
  type VerificationStatusSummary
} from "./continuation-gate.ts";

export {
  TRACE_INSPECTION_SCHEMA_VERSION,
  emitTraceInspectionEntry,
  emitTraceInspectionReport,
  formatTraceInspectionReport,
  type EmitTraceInspectionEntryOptions,
  type EmitTraceInspectionReportOptions,
  type TraceInspectionEntryV0
} from "./trace-inspection.ts";

export {
  TRACE_LEDGER_SCHEMA_VERSION,
  emitTraceLedgerEntry,
  type EmitTraceLedgerEntryOptions,
  type TraceLedgerEntryV0,
  type TraceLedgerError
} from "./trace-ledger.ts";

export {
  ContractValidationError,
  SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION,
  SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION,
  SUPPORTED_VERIFICATION_CONTRACT_SCHEMA_VERSION,
  loadPolicyProfileContract,
  loadRuntimeContracts,
  loadSemanticIrContract,
  loadVerificationContract,
  type ContractName,
  type ContractValidationCode,
  type ContractValidationIssue,
  type PolicyProfileContract,
  type RuntimeContracts,
  type SemanticIrContract,
  type VerificationContract
} from "./contracts.ts";

export {
  REPAIR_ARTIFACTS,
  REPAIR_FAILURE_CLASSES,
  REPAIR_STAGES,
  RULE_FIRST_REPAIR_ORDER,
  runRuleFirstRepairLoop,
  type RepairArtifact,
  type RepairAttemptOutcome,
  type RepairAttemptRecord,
  type RepairDecision,
  type RepairFailureClass,
  type RepairLoopInput,
  type RepairLoopResult,
  type RepairStage,
  type RunRepairLoopOptions
} from "./repair-loop.ts";

export {
  FEEDBACK_TENSOR_CALIBRATION_BANDS,
  FEEDBACK_TENSOR_FAILURE_CLASSES,
  FEEDBACK_TENSOR_FAILURE_STAGES,
  FEEDBACK_TENSOR_PROPOSED_ACTIONS,
  FEEDBACK_TENSOR_SCHEMA_VERSION,
  FEEDBACK_TENSOR_SOURCE_STAGES,
  createFeedbackTensorEntry,
  emitFeedbackTensorEntry,
  type CreateFeedbackTensorEntryInput,
  type EmitFeedbackTensorEntryOptions,
  type FeedbackTensorAlternative,
  type FeedbackTensorCalibrationBand,
  type FeedbackTensorFailureClass,
  type FeedbackTensorFailureStage,
  type FeedbackTensorProposedAction,
  type FeedbackTensorProposedRepairAction,
  type FeedbackTensorSourceStage,
  type FeedbackTensorV1
} from "./feedback-tensor.ts";

export {
  DEFAULT_PATCH_RUN_MATERIALIZATION,
  DEFAULT_PATCH_RUN_POLICY_SENSITIVE_PATH_PATTERNS,
  DEFAULT_PATCH_RUN_REQUIRED_CHECKS,
  DEFAULT_PATCH_RUN_TOOL_VERSION,
  PATCH_RUN_ARTIFACT_TYPE,
  PATCH_RUN_CHECK_STATUSES,
  PATCH_RUN_DECISIONS,
  PATCH_RUN_FORMATS,
  PATCH_RUN_REASON_CODES,
  PATCH_RUN_SCHEMA_VERSION,
  PatchRunError,
  createPatchRunArtifact,
  type CreatePatchRunArtifactOptions,
  type PatchRunArtifactInputRef,
  type PatchRunArtifactV1,
  type PatchRunCheckStatus,
  type PatchRunDecision,
  type PatchRunDraftVerificationResult,
  type PatchRunErrorCode,
  type PatchRunFormat,
  type PatchRunPatch,
  type PatchRunReasonCode,
  type PatchRunVerificationResult
} from "./patch-run.ts";

export {
  DEFAULT_SAFE_DIFF_PLAN_FORBIDDEN_PATH_PATTERNS,
  DEFAULT_SAFE_DIFF_PLAN_MAX_FILE_CHANGES,
  DEFAULT_SAFE_DIFF_PLAN_MAX_HUNKS,
  DEFAULT_SAFE_DIFF_PLAN_PLANNER_PROFILE,
  DEFAULT_SAFE_DIFF_PLAN_TOOL_VERSION,
  SAFE_DIFF_PLAN_ARTIFACT_TYPE,
  SAFE_DIFF_PLAN_DECISIONS,
  SAFE_DIFF_PLAN_EDIT_OPERATIONS,
  SAFE_DIFF_PLAN_REASON_CODES,
  SAFE_DIFF_PLAN_SCHEMA_VERSION,
  SafeDiffPlanError,
  createSafeDiffPlanArtifact,
  type CreateSafeDiffPlanArtifactOptions,
  type SafeDiffPlanArtifactInputRef,
  type SafeDiffPlanArtifactV1,
  type SafeDiffPlanDecision,
  type SafeDiffPlanDraftEdit,
  type SafeDiffPlanEdit,
  type SafeDiffPlanEditOperation,
  type SafeDiffPlanErrorCode,
  type SafeDiffPlanReasonCode
} from "./safe-diff-plan.ts";

export {
  DEFAULT_INTENT_MAPPING_AMBIGUITY_GAP,
  DEFAULT_INTENT_MAPPING_INTENT_SOURCE,
  DEFAULT_INTENT_MAPPING_MAX_ALTERNATIVES,
  DEFAULT_INTENT_MAPPING_MIN_CONFIDENCE,
  DEFAULT_INTENT_MAPPING_TOOL_VERSION,
  INTENT_MAPPING_ARTIFACT_TYPE,
  INTENT_MAPPING_DECISIONS,
  INTENT_MAPPING_EXTRACTION_METHODS,
  INTENT_MAPPING_REASON_CODES,
  INTENT_MAPPING_SCHEMA_VERSION,
  IntentMappingError,
  createIntentMappingArtifact,
  type CreateIntentMappingArtifactOptions,
  type IntentMappingArtifactInputRef,
  type IntentMappingArtifactV1,
  type IntentMappingCandidate,
  type IntentMappingCandidateRange,
  type IntentMappingDecision,
  type IntentMappingErrorCode,
  type IntentMappingExtractionMethod,
  type IntentMappingReasonCode
} from "./intent-mapping.ts";

export {
  DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS,
  DEFAULT_WORKSPACE_SNAPSHOT_TOOL_VERSION,
  WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  WORKSPACE_SNAPSHOT_TRACE_SOURCE,
  WorkspaceSnapshotError,
  createWorkspaceSnapshotArtifact,
  type CreateWorkspaceSnapshotArtifactOptions,
  type WorkspaceSnapshotArtifactInputRef,
  type WorkspaceSnapshotArtifactV1,
  type WorkspaceSnapshotErrorCode
} from "./workspace-snapshot.ts";
