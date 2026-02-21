import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  FEEDBACK_TENSOR_SCHEMA_VERSION,
  runRuleFirstRepairLoop,
  runSemanticIr,
  type VerificationContract,
  type FeedbackTensorV1,
  type TraceLedgerEntryV0
} from "../src/index.ts";

const feedbackTensorSchema = JSON.parse(
  readFileSync(new URL("../../docs/spec/schemas/feedbacktensor-v1.schema.json", import.meta.url), "utf8")
) as object;
const strictStopVerificationContract = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json",
      import.meta.url
    ),
    "utf8"
  )
) as VerificationContract;

function createFeedbackTensorValidator(): ReturnType<Ajv2020["compile"]> {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile(feedbackTensorSchema);
}

function readNdjsonEntries<T>(outputPath: string): T[] {
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
    .map((line) => JSON.parse(line) as T);
}

function makeDeterministicClock(isoTimestamps: string[]): () => Date {
  let index = 0;
  return () => {
    const current = isoTimestamps[Math.min(index, isoTimestamps.length - 1)];
    index += 1;
    return new Date(current);
  };
}

test("runtime emits linked FeedbackTensor records for failure and repair outcomes", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-feedback-emission-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");
  const runId = "run-linked-feedback-001";

  try {
    assert.throws(
      () =>
        runSemanticIr(
          {
            version: "   ",
            goal: "ship parser"
          },
          {
            traceLedgerPath,
            feedbackTensorPath,
            runIdFactory: () => runId,
            feedbackIdFactory: () => "ft-runtime-failure-001",
            now: makeDeterministicClock(["2026-02-21T22:00:00.000Z", "2026-02-21T22:00:01.000Z"])
          }
        ),
      {
        message: "SemanticIR version is required"
      }
    );

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
        runId,
        traceEntryId: runId,
        feedbackIdFactory: () => "ft-repair-outcome-001",
        now: makeDeterministicClock(["2026-02-21T22:00:02.000Z"])
      }
    );

    assert.equal(repairResult.decision, "repaired");
    assert.equal(repairResult.reasonCode, "DETERMINISTIC_TIMEOUT_RECOVERED");

    const traceEntries = readNdjsonEntries<TraceLedgerEntryV0>(traceLedgerPath);
    const feedbackEntries = readNdjsonEntries<FeedbackTensorV1>(feedbackTensorPath);
    const validateFeedbackTensor = createFeedbackTensorValidator();

    assert.equal(traceEntries.length, 1);
    assert.equal(traceEntries[0].run_id, runId);

    assert.equal(feedbackEntries.length, 2);
    for (const entry of feedbackEntries) {
      const isValid = validateFeedbackTensor(entry);
      assert.equal(
        isValid,
        true,
        `Expected schema-valid feedback tensor entry. Errors: ${JSON.stringify(
          validateFeedbackTensor.errors ?? []
        )}`
      );
      assert.equal(entry.schema_version, FEEDBACK_TENSOR_SCHEMA_VERSION);
      assert.equal(entry.provenance.run_id, traceEntries[0].run_id);
      assert.equal(entry.provenance.trace_entry_id, runId);
    }

    assert.equal(feedbackEntries[0].failure_signal.stage, "runtime");
    assert.equal(feedbackEntries[0].failure_signal.class, "schema_contract");
    assert.equal(feedbackEntries[0].failure_signal.error_code, "SEMANTIC_IR_VERSION_REQUIRED");
    assert.equal(feedbackEntries[0].provenance.source_stage, "runtime");
    assert.equal(feedbackEntries[0].failure_signal.continuation_allowed, false);
    assert.equal(feedbackEntries[0].confidence.score, 0.9);
    assert.equal(feedbackEntries[0].confidence.calibration_band, "high");
    assert.equal(feedbackEntries[0].confidence.rationale.includes("validation"), true);
    assert.equal(feedbackEntries[0].confidence.rationale.includes("contract-shape"), true);
    assert.equal(feedbackEntries[1].failure_signal.stage, "repair");
    assert.equal(feedbackEntries[1].provenance.source_stage, "repair_loop");
    assert.equal(feedbackEntries[1].failure_signal.error_code, "DETERMINISTIC_TIMEOUT_RECOVERED");
    assert.equal(feedbackEntries[1].proposed_repair_action.action, "retry_with_patch");
    assert.equal(feedbackEntries[1].confidence.score, 0.9);
    assert.equal(feedbackEntries[1].confidence.calibration_band, "high");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runtime emits medium-confidence feedback for deterministic non-schema failures", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-feedback-emission-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");

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
            runIdFactory: () => "run-runtime-deterministic-failure-001",
            feedbackIdFactory: () => "ft-runtime-deterministic-failure-001",
            now: makeDeterministicClock(["2026-02-21T22:30:00.000Z", "2026-02-21T22:30:01.000Z"]),
            continuationGate: {
              verificationContract: strictStopVerificationContract,
              feedbackTensor: {}
            }
          }
        ),
      /Continuation gate returned "stop"/
    );

    const feedbackEntries = readNdjsonEntries<FeedbackTensorV1>(feedbackTensorPath);
    assert.equal(feedbackEntries.length, 1);
    assert.equal(feedbackEntries[0].failure_signal.class, "deterministic_runtime");
    assert.equal(feedbackEntries[0].failure_signal.error_code, "VERIFICATION_REQUIRED_FEEDBACK_MISSING");
    assert.equal(feedbackEntries[0].confidence.score, 0.7);
    assert.equal(feedbackEntries[0].confidence.calibration_band, "medium");
    assert.equal(
      feedbackEntries[0].confidence.rationale.includes("deterministic local error signal"),
      true
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("repair feedback confidence is calibrated by terminal outcome", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-feedback-emission-"));
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");

  try {
    const repairedResult = runRuleFirstRepairLoop(
      {
        failureClass: "deterministic_runtime",
        stage: "runtime",
        artifact: "runtime_event",
        excerpt: "step=resolve_manifest; error=timeout; retryable=true"
      },
      {
        maxAttempts: 2,
        feedbackTensorPath,
        runId: "run-repair-confidence-repaired-001",
        feedbackIdFactory: () => "ft-repair-confidence-repaired-001",
        now: makeDeterministicClock(["2026-02-21T22:40:00.000Z"])
      }
    );
    const escalateResult = runRuleFirstRepairLoop(
      {
        failureClass: "parse",
        stage: "compile",
        artifact: "ls_source",
        excerpt: "goal Ship release"
      },
      {
        feedbackTensorPath,
        runId: "run-repair-confidence-escalate-001",
        feedbackIdFactory: () => "ft-repair-confidence-escalate-001",
        now: makeDeterministicClock(["2026-02-21T22:40:01.000Z"])
      }
    );
    const stopResult = runRuleFirstRepairLoop(
      {
        failureClass: "deterministic_runtime",
        stage: "runtime",
        artifact: "runtime_event",
        excerpt: "step=resolve_manifest; error=timeout; retryable=true"
      },
      {
        maxAttempts: 1,
        feedbackTensorPath,
        runId: "run-repair-confidence-stop-001",
        feedbackIdFactory: () => "ft-repair-confidence-stop-001",
        now: makeDeterministicClock(["2026-02-21T22:40:02.000Z"])
      }
    );

    assert.equal(repairedResult.decision, "repaired");
    assert.equal(escalateResult.decision, "escalate");
    assert.equal(stopResult.decision, "stop");

    const feedbackEntries = readNdjsonEntries<FeedbackTensorV1>(feedbackTensorPath);
    assert.equal(feedbackEntries.length, 3);
    const feedbackById = new Map(feedbackEntries.map((entry) => [entry.feedback_id, entry]));

    const repairedFeedback = feedbackById.get("ft-repair-confidence-repaired-001");
    assert.notEqual(repairedFeedback, undefined);
    assert.equal(repairedFeedback?.confidence.score, 0.9);
    assert.equal(repairedFeedback?.confidence.calibration_band, "high");

    const escalateFeedback = feedbackById.get("ft-repair-confidence-escalate-001");
    assert.notEqual(escalateFeedback, undefined);
    assert.equal(escalateFeedback?.confidence.score, 0.45);
    assert.equal(escalateFeedback?.confidence.calibration_band, "medium");

    const stopFeedback = feedbackById.get("ft-repair-confidence-stop-001");
    assert.notEqual(stopFeedback, undefined);
    assert.equal(stopFeedback?.confidence.score, 0.2);
    assert.equal(stopFeedback?.confidence.calibration_band, "low");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runtime feedback omits trace_entry_id when trace ledger append fails", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-feedback-emission-"));
  const missingTraceLedgerPath = join(tmpRoot, "missing", "runtime-trace-ledger.ndjson");
  const feedbackTensorPath = join(tmpRoot, "feedback-tensor.ndjson");
  const runId = "run-feedback-no-trace-link-001";

  try {
    assert.throws(
      () =>
        runSemanticIr(
          {
            version: " ",
            goal: "ship parser"
          },
          {
            traceLedgerPath: missingTraceLedgerPath,
            feedbackTensorPath,
            runIdFactory: () => runId,
            feedbackIdFactory: () => "ft-runtime-failure-no-trace-001",
            now: makeDeterministicClock(["2026-02-21T22:20:00.000Z", "2026-02-21T22:20:01.000Z"])
          }
        ),
      {
        message: "SemanticIR version is required"
      }
    );

    const feedbackEntries = readNdjsonEntries<FeedbackTensorV1>(feedbackTensorPath);
    const validateFeedbackTensor = createFeedbackTensorValidator();
    assert.equal(feedbackEntries.length, 1);
    assert.equal(validateFeedbackTensor(feedbackEntries[0]), true);
    assert.equal(feedbackEntries[0].provenance.run_id, runId);
    assert.equal("trace_entry_id" in feedbackEntries[0].provenance, false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runRuleFirstRepairLoop ignores feedback tensor write failures", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-feedback-emission-"));
  const missingFeedbackTensorPath = join(tmpRoot, "missing", "feedback-tensor.ndjson");

  try {
    const result = runRuleFirstRepairLoop(
      {
        failureClass: "deterministic_runtime",
        stage: "runtime",
        artifact: "runtime_event",
        excerpt: "error=timeout; retryable=true"
      },
      {
        maxAttempts: 2,
        feedbackTensorPath: missingFeedbackTensorPath,
        runId: "run-feedback-write-failure-001",
        feedbackIdFactory: () => "ft-write-failure-001",
        now: makeDeterministicClock(["2026-02-21T22:10:00.000Z"])
      }
    );

    assert.equal(result.decision, "repaired");
    assert.equal(existsSync(missingFeedbackTensorPath), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
