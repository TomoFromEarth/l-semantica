import { appendFileSync } from "node:fs";

export const FEEDBACK_TENSOR_SCHEMA_VERSION = "1.0.0";

export const FEEDBACK_TENSOR_FAILURE_CLASSES = [
  "parse",
  "schema_contract",
  "policy_gate",
  "capability_denied",
  "deterministic_runtime",
  "stochastic_extraction_uncertainty"
] as const;

export const FEEDBACK_TENSOR_FAILURE_STAGES = [
  "compile",
  "runtime",
  "policy",
  "capability",
  "repair"
] as const;

export const FEEDBACK_TENSOR_SOURCE_STAGES = ["runtime", "repair_loop", "policy_gate"] as const;

export const FEEDBACK_TENSOR_PROPOSED_ACTIONS = [
  "retry_with_patch",
  "adjust_prompt",
  "request_manual_review",
  "abort"
] as const;

export const FEEDBACK_TENSOR_CALIBRATION_BANDS = ["low", "medium", "high"] as const;

export type FeedbackTensorFailureClass = (typeof FEEDBACK_TENSOR_FAILURE_CLASSES)[number];
export type FeedbackTensorFailureStage = (typeof FEEDBACK_TENSOR_FAILURE_STAGES)[number];
export type FeedbackTensorSourceStage = (typeof FEEDBACK_TENSOR_SOURCE_STAGES)[number];
export type FeedbackTensorProposedAction = (typeof FEEDBACK_TENSOR_PROPOSED_ACTIONS)[number];
export type FeedbackTensorCalibrationBand = (typeof FEEDBACK_TENSOR_CALIBRATION_BANDS)[number];

export interface FeedbackTensorAlternative {
  id: string;
  hypothesis: string;
  expected_outcome: string;
  estimated_success_probability?: number;
}

export interface FeedbackTensorProposedRepairAction {
  action: FeedbackTensorProposedAction;
  rationale: string;
  requires_human_approval: boolean;
  target?: string;
  patch_excerpt?: string;
}

export interface FeedbackTensorV1 {
  schema_version: typeof FEEDBACK_TENSOR_SCHEMA_VERSION;
  feedback_id: string;
  generated_at: string;
  failure_signal: {
    class: FeedbackTensorFailureClass;
    stage: FeedbackTensorFailureStage;
    summary: string;
    continuation_allowed: boolean;
    error_code?: string;
  };
  confidence: {
    score: number;
    rationale: string;
    calibration_band?: FeedbackTensorCalibrationBand;
  };
  alternatives: FeedbackTensorAlternative[];
  proposed_repair_action: FeedbackTensorProposedRepairAction;
  provenance: {
    run_id: string;
    source_stage: FeedbackTensorSourceStage;
    trace_entry_id?: string;
    contract_versions: {
      semantic_ir: string;
      policy_profile: string;
      feedback_tensor: string;
    };
  };
}

export interface EmitFeedbackTensorEntryOptions {
  outputPath?: string;
}

export interface CreateFeedbackTensorEntryInput {
  feedbackId: string;
  generatedAt: string;
  failureSignal: {
    class: FeedbackTensorFailureClass;
    stage: FeedbackTensorFailureStage;
    summary: string;
    continuationAllowed: boolean;
    errorCode?: string;
  };
  confidence: {
    score: number;
    rationale: string;
    calibrationBand?: FeedbackTensorCalibrationBand;
  };
  alternatives: FeedbackTensorAlternative[];
  proposedRepairAction: FeedbackTensorProposedRepairAction;
  provenance: {
    runId: string;
    sourceStage: FeedbackTensorSourceStage;
    traceEntryId?: string;
    contractVersions: {
      semanticIr: string;
      policyProfile: string;
      feedbackTensor?: string;
    };
  };
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireNonEmptyString(value: unknown, fallback: string): string {
  return normalizeOptionalNonEmptyString(value) ?? fallback;
}

function clampProbability(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }

  return value;
}

function normalizeCalibrationBand(value: unknown): FeedbackTensorCalibrationBand | undefined {
  const normalized = normalizeOptionalNonEmptyString(value);
  if (
    normalized === FEEDBACK_TENSOR_CALIBRATION_BANDS[0] ||
    normalized === FEEDBACK_TENSOR_CALIBRATION_BANDS[1] ||
    normalized === FEEDBACK_TENSOR_CALIBRATION_BANDS[2]
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeAlternatives(alternatives: FeedbackTensorAlternative[]): FeedbackTensorAlternative[] {
  const normalized = alternatives
    .map((alternative, index) => {
      const id = requireNonEmptyString(alternative.id, `alt-${index + 1}`);
      const hypothesis = requireNonEmptyString(
        alternative.hypothesis,
        "Escalate to human review for deterministic adjudication."
      );
      const expectedOutcome = requireNonEmptyString(
        alternative.expected_outcome,
        "Task remains blocked pending review."
      );
      const estimatedSuccessProbability = clampProbability(alternative.estimated_success_probability);

      return {
        id,
        hypothesis,
        expected_outcome: expectedOutcome,
        ...(estimatedSuccessProbability === undefined
          ? {}
          : { estimated_success_probability: estimatedSuccessProbability })
      };
    })
    .filter((alternative) => alternative.id.length > 0);

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      id: "alt-manual-review",
      hypothesis: "Escalate to human review for deterministic adjudication.",
      expected_outcome: "Task remains blocked pending review.",
      estimated_success_probability: 0.95
    }
  ];
}

export function createFeedbackTensorEntry(input: CreateFeedbackTensorEntryInput): FeedbackTensorV1 {
  const feedbackId = requireNonEmptyString(input.feedbackId, `ft-fallback-${Date.now().toString(36)}`);
  const generatedAt = requireNonEmptyString(input.generatedAt, new Date().toISOString());
  const summary = requireNonEmptyString(input.failureSignal.summary, "Feedback summary unavailable.");
  const confidenceRationale = requireNonEmptyString(
    input.confidence.rationale,
    "Confidence rationale unavailable."
  );
  const proposedRationale = requireNonEmptyString(
    input.proposedRepairAction.rationale,
    "Repair action rationale unavailable."
  );
  const runId = requireNonEmptyString(input.provenance.runId, "run-unavailable");
  const semanticIrVersion = requireNonEmptyString(input.provenance.contractVersions.semanticIr, "unknown");
  const policyProfileVersion = requireNonEmptyString(
    input.provenance.contractVersions.policyProfile,
    "unknown"
  );
  const feedbackTensorVersion = requireNonEmptyString(
    input.provenance.contractVersions.feedbackTensor,
    FEEDBACK_TENSOR_SCHEMA_VERSION
  );
  const score = clampProbability(input.confidence.score) ?? 0;
  const errorCode = normalizeOptionalNonEmptyString(input.failureSignal.errorCode);
  const calibrationBand = normalizeCalibrationBand(input.confidence.calibrationBand);
  const traceEntryId = normalizeOptionalNonEmptyString(input.provenance.traceEntryId);
  const target = normalizeOptionalNonEmptyString(input.proposedRepairAction.target);
  const patchExcerpt = normalizeOptionalNonEmptyString(input.proposedRepairAction.patch_excerpt);

  return {
    schema_version: FEEDBACK_TENSOR_SCHEMA_VERSION,
    feedback_id: feedbackId,
    generated_at: generatedAt,
    failure_signal: {
      class: input.failureSignal.class,
      stage: input.failureSignal.stage,
      summary,
      continuation_allowed: input.failureSignal.continuationAllowed,
      ...(errorCode === undefined ? {} : { error_code: errorCode })
    },
    confidence: {
      score,
      rationale: confidenceRationale,
      ...(calibrationBand === undefined ? {} : { calibration_band: calibrationBand })
    },
    alternatives: normalizeAlternatives(input.alternatives),
    proposed_repair_action: {
      action: input.proposedRepairAction.action,
      rationale: proposedRationale,
      requires_human_approval: input.proposedRepairAction.requires_human_approval,
      ...(target === undefined ? {} : { target }),
      ...(patchExcerpt === undefined ? {} : { patch_excerpt: patchExcerpt })
    },
    provenance: {
      run_id: runId,
      source_stage: input.provenance.sourceStage,
      ...(traceEntryId === undefined ? {} : { trace_entry_id: traceEntryId }),
      contract_versions: {
        semantic_ir: semanticIrVersion,
        policy_profile: policyProfileVersion,
        feedback_tensor: feedbackTensorVersion
      }
    }
  };
}

export function emitFeedbackTensorEntry(
  entry: FeedbackTensorV1,
  options: EmitFeedbackTensorEntryOptions = {}
): void {
  if (!options.outputPath) {
    return;
  }

  appendFileSync(options.outputPath, `${JSON.stringify(entry)}\n`, "utf8");
}
