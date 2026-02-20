import { appendFileSync } from "node:fs";

export const TRACE_LEDGER_SCHEMA_VERSION = "0.1.0";

export interface TraceLedgerError {
  name: string;
  message: string;
}

export interface TraceLedgerEntryV0 {
  schema_version: typeof TRACE_LEDGER_SCHEMA_VERSION;
  run_id: string;
  started_at: string;
  completed_at: string;
  contract_versions: {
    semantic_ir: string;
    policy_profile: string;
  };
  outcome:
    | {
        status: "success";
      }
    | {
        status: "failure";
        error: TraceLedgerError;
      };
}

export interface EmitTraceLedgerEntryOptions {
  outputPath?: string;
}

export function emitTraceLedgerEntry(
  entry: TraceLedgerEntryV0,
  options: EmitTraceLedgerEntryOptions = {}
): void {
  if (!options.outputPath) {
    return;
  }

  appendFileSync(options.outputPath, `${JSON.stringify(entry)}\n`, "utf8");
}
