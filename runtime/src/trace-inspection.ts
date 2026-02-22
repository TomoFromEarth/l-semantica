import { appendFileSync } from "node:fs";

import type { ContinuationGateDecision } from "./continuation-gate.ts";
import type {
  FeedbackTensorCalibrationBand,
  FeedbackTensorFailureClass,
  FeedbackTensorFailureStage,
  FeedbackTensorProposedAction
} from "./feedback-tensor.ts";
import type { RepairAttemptOutcome, RepairDecision } from "./repair-loop.ts";
import type { TraceLedgerError } from "./trace-ledger.ts";

export const TRACE_INSPECTION_SCHEMA_VERSION = "0.1.0";

export interface TraceInspectionFeedbackSignal {
  class: FeedbackTensorFailureClass;
  stage: FeedbackTensorFailureStage;
  continuation_allowed: boolean;
  error_code?: string;
}

export interface TraceInspectionConfidenceSummary {
  score: number;
  rationale: string;
  calibration_band?: FeedbackTensorCalibrationBand;
}

export interface TraceInspectionProposedRepairActionSummary {
  action: FeedbackTensorProposedAction;
  requires_human_approval: boolean;
  target?: string;
}

export interface TraceInspectionRepairAttemptRecord {
  attempt: number;
  rule_id: string;
  outcome: RepairAttemptOutcome;
  reason_code: string;
  detail: string;
}

export interface TraceInspectionRepairSummary {
  decision: RepairDecision;
  continuation_allowed: boolean;
  reason_code: string;
  detail: string;
  attempts: number;
  max_attempts: number;
  applied_rule_id?: string;
  repaired_excerpt?: string;
  history: TraceInspectionRepairAttemptRecord[];
}

export interface TraceInspectionEntryV0 {
  schema_version: typeof TRACE_INSPECTION_SCHEMA_VERSION;
  run_id: string;
  started_at: string;
  completed_at: string;
  generated_at: string;
  invocation:
    | {
        status: "success";
        trace_id: string;
      }
    | {
        status: "failure";
        failure_code: string;
        error: TraceLedgerError;
      };
  continuation_gate?: {
    configured: boolean;
    decision: ContinuationGateDecision["decision"];
    continuation_allowed: boolean;
    reason_code: ContinuationGateDecision["reasonCode"];
    detail: string;
  };
  repair?: TraceInspectionRepairSummary;
  trace_ledger: {
    configured: boolean;
    emitted: boolean;
    output_path?: string;
    trace_entry_id?: string;
  };
  feedback_tensor: {
    configured: boolean;
    emitted: boolean;
    output_path?: string;
    feedback_id?: string;
    trace_entry_id?: string;
    failure_signal?: TraceInspectionFeedbackSignal;
    confidence?: TraceInspectionConfidenceSummary;
    proposed_repair_action?: TraceInspectionProposedRepairActionSummary;
  };
}

export interface EmitTraceInspectionEntryOptions {
  outputPath?: string;
}

export interface EmitTraceInspectionReportOptions {
  outputPath?: string;
}

function formatOptionalField(value: string | undefined): string {
  return value ?? "n/a";
}

function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

export function formatTraceInspectionReport(entry: TraceInspectionEntryV0): string {
  const lines: string[] = [
    "[Trace Inspection]",
    `Run ID: ${entry.run_id}`,
    `Started At: ${entry.started_at}`,
    `Completed At: ${entry.completed_at}`,
    `Generated At: ${entry.generated_at}`,
    `Invocation Status: ${entry.invocation.status}`
  ];

  if (entry.invocation.status === "success") {
    lines.push(`Trace ID: ${entry.invocation.trace_id}`);
  } else {
    lines.push(`Failure Code: ${entry.invocation.failure_code}`);
    lines.push(`Failure Error: ${entry.invocation.error.name}: ${entry.invocation.error.message}`);
  }

  if (entry.continuation_gate) {
    lines.push(`Continuation Gate Configured: ${formatBoolean(entry.continuation_gate.configured)}`);
    lines.push(
      `Continuation Decision: ${entry.continuation_gate.decision} (${entry.continuation_gate.reason_code})`
    );
    lines.push(`Continuation Allowed: ${formatBoolean(entry.continuation_gate.continuation_allowed)}`);
    lines.push(`Continuation Detail: ${entry.continuation_gate.detail}`);
  } else {
    lines.push("Continuation Gate: n/a");
  }

  if (entry.repair) {
    lines.push(`Repair Decision: ${entry.repair.decision} (${entry.repair.reason_code})`);
    lines.push(`Repair Continuation Allowed: ${formatBoolean(entry.repair.continuation_allowed)}`);
    lines.push(`Repair Attempts: ${entry.repair.attempts}/${entry.repair.max_attempts}`);
    lines.push(`Repair Applied Rule: ${formatOptionalField(entry.repair.applied_rule_id)}`);
    lines.push(`Repair Detail: ${entry.repair.detail}`);
    lines.push(`Repair Repaired Excerpt: ${formatOptionalField(entry.repair.repaired_excerpt)}`);
    if (entry.repair.history.length === 0) {
      lines.push("Repair History: none");
    } else {
      lines.push("Repair History:");
      for (const record of entry.repair.history) {
        lines.push(
          `  - #${record.attempt} ${record.rule_id}: ${record.outcome} (${record.reason_code}) ${record.detail}`
        );
      }
    }
  } else {
    lines.push("Repair Decision: n/a");
  }

  lines.push(`Trace Ledger Configured: ${formatBoolean(entry.trace_ledger.configured)}`);
  lines.push(`Trace Ledger Emitted: ${formatBoolean(entry.trace_ledger.emitted)}`);
  lines.push(`Trace Ledger Entry ID: ${formatOptionalField(entry.trace_ledger.trace_entry_id)}`);
  lines.push(`Trace Ledger Path: ${formatOptionalField(entry.trace_ledger.output_path)}`);
  lines.push(`FeedbackTensor Configured: ${formatBoolean(entry.feedback_tensor.configured)}`);
  lines.push(`FeedbackTensor Emitted: ${formatBoolean(entry.feedback_tensor.emitted)}`);
  lines.push(`FeedbackTensor ID: ${formatOptionalField(entry.feedback_tensor.feedback_id)}`);
  lines.push(
    `FeedbackTensor Trace Entry ID: ${formatOptionalField(entry.feedback_tensor.trace_entry_id)}`
  );
  lines.push(
    `FeedbackTensor Class: ${formatOptionalField(entry.feedback_tensor.failure_signal?.class)}`
  );
  lines.push(
    `FeedbackTensor Stage: ${formatOptionalField(entry.feedback_tensor.failure_signal?.stage)}`
  );
  lines.push(
    `FeedbackTensor Confidence: ${entry.feedback_tensor.confidence?.score ?? "n/a"} (${formatOptionalField(
      entry.feedback_tensor.confidence?.calibration_band
    )})`
  );
  lines.push(
    `FeedbackTensor Confidence Rationale: ${formatOptionalField(
      entry.feedback_tensor.confidence?.rationale
    )}`
  );
  lines.push(
    `FeedbackTensor Proposed Action: ${formatOptionalField(
      entry.feedback_tensor.proposed_repair_action?.action
    )}`
  );
  lines.push(`FeedbackTensor Path: ${formatOptionalField(entry.feedback_tensor.output_path)}`);

  return lines.join("\n");
}

export function emitTraceInspectionEntry(
  entry: TraceInspectionEntryV0,
  options: EmitTraceInspectionEntryOptions = {}
): void {
  if (!options.outputPath) {
    return;
  }

  appendFileSync(options.outputPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function emitTraceInspectionReport(
  entry: TraceInspectionEntryV0,
  options: EmitTraceInspectionReportOptions = {}
): void {
  if (!options.outputPath) {
    return;
  }

  appendFileSync(options.outputPath, `${formatTraceInspectionReport(entry)}\n`, "utf8");
}
