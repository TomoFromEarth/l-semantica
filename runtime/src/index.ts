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
    return {
      name: error.name || "Error",
      message: error.message
    };
  }

  return {
    name: "NonErrorThrown",
    message: String(error)
  };
}

function emitRuntimeTraceLedger(params: {
  runId: string;
  startedAt: string;
  completedAt: string;
  traceLedgerPath?: string;
  error?: TraceLedgerError;
}): void {
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

  emitTraceLedgerEntry(ledgerEntry, { outputPath: params.traceLedgerPath });
}

export function runSemanticIr(ir: SemanticIrEnvelope, options: RunSemanticIrOptions = {}): RuntimeResult {
  const now = options.now ?? (() => new Date());
  const runIdFactory = options.runIdFactory ?? (() => randomUUID());

  const runId = runIdFactory();
  const startedAt = now().toISOString();

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
    try {
      emitRuntimeTraceLedger({
        runId,
        startedAt,
        completedAt: now().toISOString(),
        traceLedgerPath: options.traceLedgerPath,
        error: invocationError
      });
    } catch (traceLedgerError) {
      if (invocationError === undefined) {
        throw traceLedgerError;
      }
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
  loadPolicyProfileContract,
  loadRuntimeContracts,
  loadSemanticIrContract,
  type ContractName,
  type ContractValidationCode,
  type ContractValidationIssue,
  type PolicyProfileContract,
  type RuntimeContracts,
  type SemanticIrContract
} from "./contracts.ts";
