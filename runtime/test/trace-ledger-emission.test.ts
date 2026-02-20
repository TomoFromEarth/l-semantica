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

test("runSemanticIr tolerates invalid or throwing now hooks", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  let nowCallCount = 0;
  const unstableNow = (): Date => {
    nowCallCount += 1;
    if (nowCallCount === 1) {
      return new Date(Number.NaN);
    }
    throw new Error("clock unavailable");
  };

  try {
    const result = runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath,
        runIdFactory: () => "run-unstable-clock-001",
        now: unstableNow
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.traceId, "trace-0.1.0");
    assert.equal(nowCallCount, 2);

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);
    assert.equal(Number.isNaN(Date.parse(entries[0].started_at)), false);
    assert.equal(Number.isNaN(Date.parse(entries[0].completed_at)), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr preserves original non-Error throws with safe ledger message fallback", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  const nonErrorThrown = {
    toString() {
      throw new Error("stringify failed");
    }
  };

  const irWithThrowingGetter = {
    get version(): string {
      throw nonErrorThrown;
    },
    goal: "ship parser"
  } as unknown as { version: string; goal: string };

  try {
    assert.throws(
      () =>
        runSemanticIr(irWithThrowingGetter, {
          traceLedgerPath,
          runIdFactory: () => "run-non-error-throw-001",
          now: makeDeterministicClock(["2026-02-20T14:00:00.000Z", "2026-02-20T14:00:01.000Z"])
        }),
      (error) => {
        assert.equal(error, nonErrorThrown);
        return true;
      }
    );

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome.status, "failure");
    if (entries[0].outcome.status !== "failure") {
      assert.fail("Expected failed trace ledger outcome");
    }
    assert.equal(entries[0].outcome.error.name, "NonErrorThrown");
    assert.equal(entries[0].outcome.error.message, "[unstringifiable thrown value]");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr does not evaluate trace hooks when trace ledger output is disabled", () => {
  let runIdFactoryCalls = 0;
  let nowCalls = 0;

  const result = runSemanticIr(
    {
      version: "0.1.0",
      goal: "ship parser"
    },
    {
      runIdFactory: () => {
        runIdFactoryCalls += 1;
        throw new Error("run id factory should not be called");
      },
      now: () => {
        nowCalls += 1;
        throw new Error("clock hook should not be called");
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.traceId, "trace-0.1.0");
  assert.equal(runIdFactoryCalls, 0);
  assert.equal(nowCalls, 0);
});

test("runSemanticIr falls back to best-effort run id when runIdFactory throws", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  try {
    const result = runSemanticIr(
      {
        version: "0.1.0",
        goal: "ship parser"
      },
      {
        traceLedgerPath,
        runIdFactory: () => {
          throw new Error("run id factory failed");
        },
        now: makeDeterministicClock(["2026-02-20T15:00:00.000Z", "2026-02-20T15:00:01.000Z"])
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.traceId, "trace-0.1.0");

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].run_id.trim().length > 0, true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("runSemanticIr normalizes whitespace Error names in failure trace entries", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "l-semantica-trace-ledger-"));
  const traceLedgerPath = join(tmpRoot, "runtime-trace-ledger.ndjson");

  const whitespaceNameError = new Error("semantic version lookup failed");
  whitespaceNameError.name = "   ";

  const irWithThrowingGetter = {
    get version(): string {
      throw whitespaceNameError;
    },
    goal: "ship parser"
  } as unknown as { version: string; goal: string };

  try {
    assert.throws(
      () =>
        runSemanticIr(irWithThrowingGetter, {
          traceLedgerPath,
          runIdFactory: () => "run-whitespace-error-name-001",
          now: makeDeterministicClock(["2026-02-20T16:00:00.000Z", "2026-02-20T16:00:01.000Z"])
        }),
      (error) => {
        assert.equal(error, whitespaceNameError);
        return true;
      }
    );

    const entries = readTraceLedgerEntries(traceLedgerPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome.status, "failure");
    if (entries[0].outcome.status !== "failure") {
      assert.fail("Expected failed trace ledger outcome");
    }
    assert.equal(entries[0].outcome.error.name, "Error");
    assert.equal(entries[0].outcome.error.message, "semantic version lookup failed");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
