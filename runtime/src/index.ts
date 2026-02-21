import { randomUUID } from "node:crypto";

import {
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

export interface SemanticIrEnvelope {
  version: string;
  goal: string;
}

export interface RuntimeResult {
  ok: true;
  traceId: string;
}

export interface RunSemanticIrOptions {
  traceLedgerPath?: string;
  feedbackTensorPath?: string;
  now?: () => Date;
  runIdFactory?: () => string;
  feedbackIdFactory?: () => string;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
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

function resolveRuntimeFailureClass(error: TraceLedgerError): FeedbackTensorFailureClass {
  if (error.message.startsWith("SemanticIR")) {
    return "schema_contract";
  }

  return "deterministic_runtime";
}

function emitRuntimeFailureFeedbackTensor(params: {
  runId: string;
  generatedAt: string;
  feedbackTensorPath?: string;
  feedbackIdFactory: () => string;
  error: TraceLedgerError;
  traceEntryId?: string;
}): void {
  if (!params.feedbackTensorPath) {
    return;
  }

  const failureClass = resolveRuntimeFailureClass(params.error);
  const entry = createFeedbackTensorEntry({
    feedbackId: resolveFeedbackId(params.feedbackIdFactory),
    generatedAt: params.generatedAt,
    failureSignal: {
      class: failureClass,
      stage: "runtime",
      summary: params.error.message,
      continuationAllowed: false,
      errorCode: params.error.name
    },
    confidence: {
      score: failureClass === "schema_contract" ? 0.9 : 0.7,
      rationale:
        failureClass === "schema_contract"
          ? "Input validation indicates a contract-shape violation before autonomous continuation."
          : "Runtime invocation failed with a deterministic local error signal.",
      calibrationBand: failureClass === "schema_contract" ? "high" : "medium"
    },
    alternatives: [
      {
        id: "alt-deterministic-repair",
        hypothesis: "Run deterministic repair workflow over the failure payload.",
        expected_outcome: "Known failure classes can be auto-repaired without unsafe continuation.",
        estimated_success_probability: failureClass === "schema_contract" ? 0.8 : 0.65
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
      target: failureClass === "schema_contract" ? "semantic_ir.contract" : "runtime.invocation"
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
  } catch {}
}

function emitRuntimeTraceLedger(params: {
  runId: string;
  startedAt: string;
  completedAt: string;
  traceLedgerPath?: string;
  error?: TraceLedgerError;
}): void {
  if (!params.traceLedgerPath) {
    return;
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
  } catch {}
}

export function runSemanticIr(ir: SemanticIrEnvelope, options: RunSemanticIrOptions = {}): RuntimeResult {
  const now = options.now ?? (() => new Date());
  const runIdFactory = options.runIdFactory ?? (() => randomUUID());
  const feedbackIdFactory = options.feedbackIdFactory ?? (() => createFeedbackIdFallback());
  const traceLedgerPath = normalizeOutputPath(options.traceLedgerPath);
  const feedbackTensorPath = normalizeOutputPath(options.feedbackTensorPath);

  const shouldResolveRunContext = traceLedgerPath !== undefined || feedbackTensorPath !== undefined;
  const runId = shouldResolveRunContext ? resolveTraceRunId(runIdFactory) : "";
  const startedAt = traceLedgerPath ? resolveTraceTimestamp(now) : "";

  let invocationError: TraceLedgerError | undefined;
  try {
    if (typeof ir !== "object" || ir === null || Array.isArray(ir)) {
      throw new Error("SemanticIR input must be an object");
    }

    const version = requireNonEmptyString(
      (ir as { version?: unknown }).version,
      "SemanticIR version is required"
    );
    requireNonEmptyString((ir as { goal?: unknown }).goal, "SemanticIR goal is required");

    return {
      ok: true,
      traceId: `trace-${version}`
    };
  } catch (error) {
    invocationError = toTraceLedgerError(error);
    throw error;
  } finally {
    const completedAt = shouldResolveRunContext ? resolveTraceTimestamp(now) : "";

    if (traceLedgerPath) {
      emitRuntimeTraceLedger({
        runId,
        startedAt,
        completedAt,
        traceLedgerPath,
        error: invocationError
      });
    }

    if (feedbackTensorPath && invocationError) {
      emitRuntimeFailureFeedbackTensor({
        runId,
        generatedAt: completedAt,
        feedbackTensorPath,
        feedbackIdFactory,
        error: invocationError,
        traceEntryId: traceLedgerPath ? runId : undefined
      });
    }
  }
}

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
