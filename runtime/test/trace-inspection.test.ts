import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TRACE_INSPECTION_SCHEMA_VERSION,
  runRuleFirstRepairLoop,
  runSemanticIr,
  type TraceInspectionEntryV0,
  type VerificationContract
} from "../src/index.ts";

const strictStopVerificationContract = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json",
      import.meta.url
    ),
    "utf8"
  )
) as VerificationContract;

function readInspectionEntries(outputPath: string): TraceInspectionEntryV0[] {
  if (!existsSync(outputPath)) {
    return [];
  }

  const rawContents = readFileSync(outputPath, "utf8").trim();
  if (rawContents.length === 0) {
    return [];
  }

  return rawContents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TraceInspectionEntryV0);
}

function makeDeterministicClock(isoTimestamps: [string, string] | string[]): () => Date {
  let index = 0;
  return () => {
    const next = isoTimestamps[Math.min(index, isoTimestamps.length - 1)];
    index += 1;
    return new Date(next);
  };
}

test("runSemanticIr emits trace inspection machine + report output for successful invocation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-inspection-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");
  const traceInspectionPath = join(tmpRoot, "trace-inspection.ndjson");
  const traceInspectionReportPath = join(tmpRoot, "trace-inspection.txt");
  const runId = "run-trace-inspection-success-001";

  try {
    const result = runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath,
        traceInspectionPath,
        traceInspectionReportPath,
        runIdFactory: () => runId,
        now: makeDeterministicClock(["2026-02-22T00:00:00.000Z", "2026-02-22T00:00:01.000Z"])
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.traceId, "trace-0.1.0");

    const entries = readInspectionEntries(traceInspectionPath);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    assert.equal(entry.schema_version, TRACE_INSPECTION_SCHEMA_VERSION);
    assert.equal(entry.run_id, runId);
    assert.equal(entry.started_at, "2026-02-22T00:00:00.000Z");
    assert.equal(entry.completed_at, "2026-02-22T00:00:01.000Z");
    assert.equal(entry.generated_at, "2026-02-22T00:00:01.000Z");
    assert.equal(entry.invocation.status, "success");
    if (entry.invocation.status !== "success") {
      assert.fail("Expected successful inspection invocation state");
    }
    assert.equal(entry.invocation.trace_id, "trace-0.1.0");
    assert.equal(entry.trace_ledger.configured, true);
    assert.equal(entry.trace_ledger.emitted, true);
    assert.equal(entry.trace_ledger.output_path, traceLedgerPath);
    assert.equal(entry.trace_ledger.trace_entry_id, runId);
    assert.equal(entry.feedback_tensor.configured, false);
    assert.equal(entry.feedback_tensor.emitted, false);
    assert.equal("feedback_id" in entry.feedback_tensor, false);
    assert.equal(entry.continuation_gate?.configured, false);
    assert.equal(entry.continuation_gate?.decision, "continue");
    assert.equal(entry.continuation_gate?.reason_code, "CONTINUATION_GATE_NOT_CONFIGURED");
    assert.equal(entry.continuation_gate?.continuation_allowed, true);
    assert.equal(entry.repair, undefined);

    const report = readFileSync(traceInspectionReportPath, "utf8");
    assert.equal(report.includes(`[Trace Inspection]\nRun ID: ${runId}`), true);
    assert.equal(report.includes("Invocation Status: success"), true);
    assert.equal(report.includes(`Trace Ledger Entry ID: ${runId}`), true);
    assert.equal(report.includes("FeedbackTensor Emitted: no"), true);
    assert.equal(
      report.includes("Continuation Decision: continue (CONTINUATION_GATE_NOT_CONFIGURED)"),
      true
    );
    assert.equal(report.includes("Repair Decision: n/a"), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr emits trace inspection linkage with confidence metadata for failed continuation-gate invocation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-inspection-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");
  const traceInspectionPath = join(tmpRoot, "trace-inspection.ndjson");
  const traceInspectionReportPath = join(tmpRoot, "trace-inspection.txt");
  const runId = "run-trace-inspection-failure-001";
  const feedbackId = "ft-trace-inspection-failure-001";

  try {
    assert.throws(
      () =>
        runSemanticIr(
          {
            version: "0.1.0",
            goal: "ship parser"
          },
          {
            traceLedgerPath,
            feedbackTensorPath,
            traceInspectionPath,
            traceInspectionReportPath,
            runIdFactory: () => runId,
            feedbackIdFactory: () => feedbackId,
            now: makeDeterministicClock(["2026-02-22T01:00:00.000Z", "2026-02-22T01:00:01.000Z"]),
            continuationGate: {
              verificationContract: strictStopVerificationContract,
              feedbackTensor: {}
            }
          }
        ),
      /Continuation gate returned "stop"/
    );

    const entries = readInspectionEntries(traceInspectionPath);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    assert.equal(entry.schema_version, TRACE_INSPECTION_SCHEMA_VERSION);
    assert.equal(entry.run_id, runId);
    assert.equal(entry.invocation.status, "failure");
    if (entry.invocation.status !== "failure") {
      assert.fail("Expected failed inspection invocation state");
    }
    assert.equal(entry.invocation.failure_code, "VERIFICATION_REQUIRED_FEEDBACK_MISSING");
    assert.equal(entry.invocation.error.message.includes("Autonomous continuation is blocked"), true);
    assert.equal(entry.trace_ledger.emitted, true);
    assert.equal(entry.trace_ledger.trace_entry_id, runId);
    assert.equal(entry.feedback_tensor.configured, true);
    assert.equal(entry.feedback_tensor.emitted, true);
    assert.equal(entry.feedback_tensor.feedback_id, feedbackId);
    assert.equal(entry.feedback_tensor.trace_entry_id, runId);
    assert.equal(entry.feedback_tensor.failure_signal?.class, "deterministic_runtime");
    assert.equal(entry.feedback_tensor.failure_signal?.stage, "runtime");
    assert.equal(entry.feedback_tensor.confidence?.score, 0.7);
    assert.equal(entry.feedback_tensor.confidence?.calibration_band, "medium");
    assert.equal(
      entry.feedback_tensor.confidence?.rationale.includes("deterministic local error signal"),
      true
    );
    assert.equal(entry.feedback_tensor.proposed_repair_action?.action, "retry_with_patch");
    assert.equal(entry.continuation_gate?.configured, true);
    assert.equal(entry.continuation_gate?.decision, "stop");
    assert.equal(entry.continuation_gate?.reason_code, "VERIFICATION_REQUIRED_FEEDBACK_MISSING");
    assert.equal(entry.continuation_gate?.continuation_allowed, false);

    const report = readFileSync(traceInspectionReportPath, "utf8");
    assert.equal(report.includes(`FeedbackTensor ID: ${feedbackId}`), true);
    assert.equal(
      report.includes("Continuation Decision: stop (VERIFICATION_REQUIRED_FEEDBACK_MISSING)"),
      true
    );
    assert.equal(report.includes(`Trace Ledger Entry ID: ${runId}`), true);
    assert.equal(report.includes("FeedbackTensor Confidence: 0.7 (medium)"), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runRuleFirstRepairLoop emits trace inspection with repair outcome and attempts history", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-inspection-"));
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");
  const traceInspectionPath = join(tmpRoot, "trace-inspection.ndjson");
  const traceInspectionReportPath = join(tmpRoot, "trace-inspection.txt");
  const runId = "run-repair-trace-inspection-001";
  const feedbackId = "ft-repair-trace-inspection-001";

  try {
    const repairResult = runRuleFirstRepairLoop(
      {
        failureClass: "deterministic_runtime",
        stage: "runtime",
        artifact: "runtime_event",
        excerpt: "error=timeout; retryable=true"
      },
      {
        maxAttempts: 2,
        feedbackTensorPath,
        traceInspectionPath,
        traceInspectionReportPath,
        runId,
        traceEntryId: runId,
        feedbackIdFactory: () => feedbackId,
        now: makeDeterministicClock([
          "2026-02-22T02:00:00.000Z",
          "2026-02-22T02:00:01.000Z",
          "2026-02-22T02:00:02.000Z"
        ])
      }
    );

    assert.equal(repairResult.decision, "repaired");
    assert.equal(repairResult.reasonCode, "DETERMINISTIC_TIMEOUT_RECOVERED");

    const entries = readInspectionEntries(traceInspectionPath);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    assert.equal(entry.schema_version, TRACE_INSPECTION_SCHEMA_VERSION);
    assert.equal(entry.run_id, runId);
    assert.equal(entry.invocation.status, "success");
    if (entry.invocation.status === "success") {
      assert.equal(entry.invocation.trace_id, `repair-${runId}`);
      assert.notEqual(entry.invocation.trace_id, runId);
    }
    assert.notEqual(entry.repair, undefined);
    assert.equal(entry.repair?.decision, "repaired");
    assert.equal(entry.repair?.reason_code, "DETERMINISTIC_TIMEOUT_RECOVERED");
    assert.equal(entry.repair?.attempts, 2);
    assert.equal(entry.repair?.max_attempts, 2);
    assert.equal(entry.repair?.history.length, 2);
    assert.equal(entry.repair?.history[0].outcome, "retry");
    assert.equal(entry.repair?.history[1].outcome, "repaired");
    assert.equal(entry.trace_ledger.trace_entry_id, runId);
    assert.equal(entry.trace_ledger.emitted, true);
    assert.equal(entry.feedback_tensor.feedback_id, feedbackId);
    assert.equal(entry.feedback_tensor.trace_entry_id, runId);
    assert.equal(entry.feedback_tensor.failure_signal?.stage, "repair");
    assert.equal(entry.feedback_tensor.confidence?.score, 0.9);
    assert.equal(entry.feedback_tensor.confidence?.calibration_band, "high");

    const report = readFileSync(traceInspectionReportPath, "utf8");
    assert.equal(report.includes("Continuation Gate: n/a"), true);
    assert.equal(
      report.includes("Repair Decision: repaired (DETERMINISTIC_TIMEOUT_RECOVERED)"),
      true
    );
    assert.equal(report.includes("Repair History:"), true);
    assert.equal(report.includes("DETERMINISTIC_TIMEOUT_RETRY"), true);
    assert.equal(report.includes("DETERMINISTIC_TIMEOUT_RECOVERED"), true);
    assert.equal(report.includes("FeedbackTensor Confidence: 0.9 (high)"), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr ignores trace inspection write failures", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-inspection-"));
  const missingInspectionPath = join(tmpRoot, "missing", "trace-inspection.ndjson");
  const missingReportPath = join(tmpRoot, "missing", "trace-inspection.txt");

  try {
    const result = runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceInspectionPath: missingInspectionPath,
        traceInspectionReportPath: missingReportPath,
        runIdFactory: () => "run-trace-inspection-write-failure-001",
        now: makeDeterministicClock(["2026-02-22T03:00:00.000Z", "2026-02-22T03:00:01.000Z"])
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.traceId, "trace-0.1.0");
    assert.equal(existsSync(missingInspectionPath), false);
    assert.equal(existsSync(missingReportPath), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
