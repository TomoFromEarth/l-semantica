import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION,
  SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION,
  TRACE_LEDGER_SCHEMA_VERSION,
  runSemanticIr,
  type TraceLedgerEntryV0
} from "../src/index.ts";

function readTraceLedgerEntries(outputPath: string): TraceLedgerEntryV0[] {
  const rawContents = readFileSync(outputPath, "utf8").trim();
  if (rawContents.length === 0) {
    return [];
  }

  return rawContents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TraceLedgerEntryV0);
}

function makeDeterministicClock(isoTimestamps: [string, string]): () => Date {
  let index = 0;
  return () => {
    const next = isoTimestamps[Math.min(index, isoTimestamps.length - 1)];
    index += 1;
    return new Date(next);
  };
}

test("runSemanticIr emits trace ledger entry for successful invocation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  try {
    runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath,
        runIdFactory: () => "run-success-001",
        now: makeDeterministicClock(["2026-02-20T10:00:00.000Z", "2026-02-20T10:00:01.000Z"])
      }
    );

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    assert.equal(entry.schema_version, TRACE_LEDGER_SCHEMA_VERSION);
    assert.equal(entry.run_id, "run-success-001");
    assert.equal(entry.started_at, "2026-02-20T10:00:00.000Z");
    assert.equal(entry.completed_at, "2026-02-20T10:00:01.000Z");
    assert.equal(entry.contract_versions.semantic_ir, SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION);
    assert.equal(entry.contract_versions.policy_profile, SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION);
    assert.equal(entry.outcome.status, "success");
    assert.equal("error" in entry.outcome, false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr emits trace ledger entry for failed invocation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  try {
    assert.throws(
      () =>
        runSemanticIr(
          {
            version: " ",
            goal: "ship parser"
          },
          {
            traceLedgerPath,
            runIdFactory: () => "run-failure-001",
            now: makeDeterministicClock(["2026-02-20T11:00:00.000Z", "2026-02-20T11:00:01.000Z"])
          }
        ),
      {
        message: "SemanticIR version is required"
      }
    );

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    assert.equal(entry.schema_version, TRACE_LEDGER_SCHEMA_VERSION);
    assert.equal(entry.run_id, "run-failure-001");
    assert.equal(entry.started_at, "2026-02-20T11:00:00.000Z");
    assert.equal(entry.completed_at, "2026-02-20T11:00:01.000Z");
    assert.equal(entry.contract_versions.semantic_ir, SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION);
    assert.equal(entry.contract_versions.policy_profile, SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION);
    assert.equal(entry.outcome.status, "failure");
    if (entry.outcome.status !== "failure") {
      assert.fail("Expected failed trace ledger outcome");
    }
    assert.equal(entry.outcome.error.name, "Error");
    assert.equal(entry.outcome.error.message, "SemanticIR version is required");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr normalizes invalid run ids before ledger emission", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  try {
    runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath,
        runIdFactory: () => "   ",
        now: makeDeterministicClock(["2026-02-20T12:00:00.000Z", "2026-02-20T12:00:01.000Z"])
      }
    );

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].run_id.trim().length > 0, true);
    assert.notEqual(entries[0].run_id, "   ");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr ignores trace ledger write failures on successful invocations", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const missingTraceLedgerPath = join(tmpRoot, "missing", "runtime-trace-ledger.ndjson");

  try {
    const result = runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath: missingTraceLedgerPath,
        runIdFactory: () => "run-success-with-write-failure-001",
        now: makeDeterministicClock(["2026-02-20T13:00:00.000Z", "2026-02-20T13:00:01.000Z"])
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.traceId, "trace-0.1.0");
    assert.equal(existsSync(missingTraceLedgerPath), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
