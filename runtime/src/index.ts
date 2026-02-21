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
  now?: () => Date;
  runIdFactory?: () => string;
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

function normalizeTraceLedgerPath(traceLedgerPath?: string): string | undefined {
  if (typeof traceLedgerPath !== "string") {
    return undefined;
  }

  const trimmed = traceLedgerPath.trim();
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

function resolveTraceTimestamp(now: () => Date): string {
  try {
    const candidate = now();
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate.toISOString();
    }
  } catch {}

  return new Date().toISOString();
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
  const traceLedgerPath = normalizeTraceLedgerPath(options.traceLedgerPath);

  const runId = traceLedgerPath ? resolveTraceRunId(runIdFactory) : "";
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
    if (traceLedgerPath) {
      emitRuntimeTraceLedger({
        runId,
        startedAt,
        completedAt: resolveTraceTimestamp(now),
        traceLedgerPath,
        error: invocationError
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
