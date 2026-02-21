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
  type FeedbackTensorV1,
  type TraceLedgerEntryV0
} from "../src/index.ts";

const feedbackTensorSchema = JSON.parse(
  readFileSync(new URL("../../docs/spec/schemas/feedbacktensor-v1.schema.json", import.meta.url), "utf8")
) as object;

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
    assert.equal(feedbackEntries[0].provenance.source_stage, "runtime");
    assert.equal(feedbackEntries[0].failure_signal.continuation_allowed, false);
    assert.equal(feedbackEntries[1].failure_signal.stage, "repair");
    assert.equal(feedbackEntries[1].provenance.source_stage, "repair_loop");
    assert.equal(feedbackEntries[1].failure_signal.error_code, "DETERMINISTIC_TIMEOUT_RECOVERED");
    assert.equal(feedbackEntries[1].proposed_repair_action.action, "retry_with_patch");
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
