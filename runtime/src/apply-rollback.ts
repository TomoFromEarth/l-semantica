import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { posix } from "node:path";

import {
  DEFAULT_PATCH_RUN_POLICY_SENSITIVE_PATH_PATTERNS,
  PATCH_RUN_DECISIONS,
  PATCH_RUN_REASON_CODES,
  type PatchRunCheckStatus,
  type PatchRunDecision,
  type PatchRunVerificationResult
} from "./patch-run.ts";
import {
  PR_BUNDLE_ARTIFACT_TYPE,
  PR_BUNDLE_REASON_CODES,
  PR_BUNDLE_ROLLBACK_STRATEGIES,
  PR_BUNDLE_SCHEMA_VERSION,
  type PrBundleArtifactV1,
  type PrBundleDiffPlanEditSummary,
  type PrBundleReadiness,
  type PrBundleRollbackStrategy
} from "./pr-bundle.ts";

export const APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE = "ls.m2.apply_rollback_record";
export const APPLY_ROLLBACK_RECORD_SCHEMA_VERSION = "1.0.0";
export const LEGACY_BENCHMARK_REPORT_ARTIFACT_TYPE = "ls.m2.legacy_benchmark_report";
export const LEGACY_BENCHMARK_REPORT_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_APPLY_ROLLBACK_TOOL_VERSION = "@l-semantica/runtime@0.1.0";
export const DEFAULT_APPLY_ROLLBACK_BOUNDARY_MODE = "artifact_only";
export const DEFAULT_APPLY_ROLLBACK_EXECUTION_MODE = "deterministic_workspace_placeholder_v1";
export const DEFAULT_APPLY_ROLLBACK_POLICY_PROFILE_REF = "policy.unspecified";
export const DEFAULT_APPLY_ROLLBACK_VERIFICATION_CONTRACT_REF = "verification.unspecified";
export const DEFAULT_APPLY_REQUIRED_CAPABILITY = "workspace.apply_patch";
export const DEFAULT_ROLLBACK_REQUIRED_CAPABILITY = "workspace.rollback_patch";
export const DEFAULT_APPLY_ROLLBACK_ESCALATION_PATH_PATTERNS = [
  ...DEFAULT_PATCH_RUN_POLICY_SENSITIVE_PATH_PATTERNS
] as const;
export const DEFAULT_APPLY_ROLLBACK_BLOCKED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_ed25519",
  "**/credentials*"
] as const;
export const APPLY_ROLLBACK_ACTIONS = ["apply", "rollback"] as const;
export const APPLY_ROLLBACK_DECISIONS = ["continue", "escalate", "stop"] as const;
export const APPLY_ROLLBACK_REASON_CODES = [
  "ok",
  "unsupported_input",
  "mapping_ambiguous",
  "mapping_low_confidence",
  "forbidden_path",
  "change_bound_exceeded",
  "conflict_detected",
  "verification_failed",
  "verification_incomplete",
  "policy_blocked",
  "rollback_unavailable",
  "undeclared_capability",
  "benchmark_quality_floor_failed",
  "benchmark_invalid_gain",
  "bundle_incomplete",
  "prior_apply_record_missing"
] as const;

const PR_BUNDLE_REASON_CODE_SET = new Set<string>(PR_BUNDLE_REASON_CODES);
const PATCH_RUN_REASON_CODE_SET = new Set<string>(PATCH_RUN_REASON_CODES);
const PATCH_RUN_DECISION_SET = new Set<string>(PATCH_RUN_DECISIONS);
const PR_BUNDLE_ROLLBACK_STRATEGY_SET = new Set<string>(PR_BUNDLE_ROLLBACK_STRATEGIES);
const APPLY_ROLLBACK_REASON_CODE_SET = new Set<string>(APPLY_ROLLBACK_REASON_CODES);
const PATH_GLOB_REGEX_CACHE = new Map<string, RegExp>();

export type ApplyRollbackAction = (typeof APPLY_ROLLBACK_ACTIONS)[number];
export type ApplyRollbackDecision = (typeof APPLY_ROLLBACK_DECISIONS)[number];
export type ApplyRollbackReasonCode = (typeof APPLY_ROLLBACK_REASON_CODES)[number];

export type ApplyRollbackErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_PR_BUNDLE"
  | "INVALID_PREVIOUS_RECORD"
  | "INVALID_BENCHMARK_REPORT"
  | "EXECUTION_FAILED";

export class ApplyRollbackError extends Error {
  readonly code: ApplyRollbackErrorCode;

  constructor(message: string, code: ApplyRollbackErrorCode) {
    super(message);
    this.name = "ApplyRollbackError";
    this.code = code;
  }
}

export interface ApplyRollbackArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface ApplyRollbackFileSnapshotEntry {
  path: string;
  exists: boolean;
  byte_length: number;
  content_sha256: string | null;
  content_base64: string | null;
}

export interface ApplyRollbackStateSnapshot {
  digest: string;
  files: ApplyRollbackFileSnapshotEntry[];
}

export interface ApplyRollbackBenchmarkGateSummary {
  benchmark_artifact_id: string;
  decision: "continue" | "escalate" | "stop";
  reason_code: string;
  reason_detail: string;
  quality_floor_preserved: boolean;
  valid_gain: boolean;
  enforced: boolean;
}

export interface ApplyRollbackArtifactV1 {
  artifact_type: typeof APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE;
  schema_version: typeof APPLY_ROLLBACK_RECORD_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: ApplyRollbackArtifactInputRef[];
  trace: {
    lineage: string[];
    boundary_mode: typeof DEFAULT_APPLY_ROLLBACK_BOUNDARY_MODE;
    policy_profile_ref: string;
    verification_contract_ref: string;
    target_workspace_ref: string | null;
  };
  payload: {
    action: ApplyRollbackAction;
    decision: ApplyRollbackDecision;
    reason_code: ApplyRollbackReasonCode;
    reason_detail: string;
    policy: {
      action_allowed: boolean;
      approval_required: boolean;
      approval_evidence_ref: string | null;
      required_capability: string;
      declared_capabilities: string[];
      missing_capabilities: string[];
      blocked_paths: string[];
      escalation_paths: string[];
    };
    verification: {
      patch_run_artifact_id: string;
      pr_bundle_ready: boolean;
      pr_bundle_readiness: {
        decision: PrBundleReadiness["decision"];
        reason_code: string;
        reason_detail: string;
      };
      patch_run_outcome: {
        decision: PatchRunDecision;
        reason_code: string;
        reason_detail: string;
      };
      required_checks: string[];
      results: PatchRunVerificationResult[];
      checks_complete: boolean;
      evidence_complete: boolean;
      all_required_passed: boolean;
      missing_required_checks: string[];
      incomplete_checks: string[];
      failing_checks: string[];
    };
    rollback: {
      available: boolean;
      strategy: PrBundleRollbackStrategy | null;
      package_ref: string | null;
      package_digest: string | null;
      package_format: string | null;
      package_valid: boolean;
      instructions_present: boolean;
      prior_apply_record_artifact_id: string | null;
      previous_apply_restore_snapshot_available: boolean;
      restored_to_prior_state: boolean;
    };
    target_state: {
      changed_paths: string[];
      expected_precondition_digest: string | null;
      observed_precondition_digest: string;
      preconditions_met: boolean;
      observed_result_digest: string;
    };
    execution: {
      mode: typeof DEFAULT_APPLY_ROLLBACK_EXECUTION_MODE;
      execute_requested: boolean;
      executed: boolean;
      state_before: ApplyRollbackStateSnapshot;
      state_after: ApplyRollbackStateSnapshot;
    };
    traceability: {
      pr_bundle_artifact_id: string;
      patch_run_artifact_id: string;
      benchmark_gate: ApplyRollbackBenchmarkGateSummary | null;
    };
  };
}

export interface CreateApplyRollbackRecordArtifactOptions {
  action: ApplyRollbackAction;
  prBundle: PrBundleArtifactV1;
  workspaceRoot: string;
  execute?: boolean;
  previousApplyRecord?: ApplyRollbackArtifactV1;
  benchmarkReport?: unknown;
  requireBenchmarkValidGain?: boolean;
  expectedTargetStateDigest?: string;
  targetWorkspaceRef?: string | null;
  policyProfileRef?: string;
  verificationContractRef?: string;
  declaredCapabilities?: string[];
  allowAction?: boolean;
  approvalRequired?: boolean;
  approvalEvidenceRef?: string | null;
  escalationPathPatterns?: string[];
  blockedPathPatterns?: string[];
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface ApplyRollbackStageDecision {
  decision: ApplyRollbackDecision;
  reasonCode: ApplyRollbackReasonCode;
  reasonDetail: string;
}

interface NormalizedPrBundleInput {
  inputRef: ApplyRollbackArtifactInputRef;
  runId: string;
  traceLineage: string[];
  patchRunRef: ApplyRollbackArtifactInputRef;
  patchDigest: string;
  patchContent: string;
  patchFormat: string;
  patchRunArtifactIdFromPayload: string;
  verification: ApplyRollbackArtifactV1["payload"]["verification"];
  rollback: {
    available: boolean;
    strategy: PrBundleRollbackStrategy | null;
    packageRef: string | null;
    packageDigest: string | null;
    packageFormat: string | null;
    packageValid: boolean;
    instructionsPresent: boolean;
  };
  readiness: {
    decision: PrBundleReadiness["decision"];
    reasonCode: string;
    reasonDetail: string;
  };
  patchRunOutcome: {
    decision: PatchRunDecision;
    reasonCode: string;
    reasonDetail: string;
  };
  edits: Array<{
    path: string;
    operation: "create" | "modify" | "delete";
    targetId?: string;
    symbolPath?: string | null;
  }>;
}

interface NormalizedPreviousApplyRecord {
  inputRef: ApplyRollbackArtifactInputRef;
  runId: string;
  prBundleArtifactId: string;
  stateBefore: ApplyRollbackStateSnapshot;
  stateAfter: ApplyRollbackStateSnapshot;
  changedPaths: string[];
  rollbackAvailable: boolean;
  rollbackStrategy: PrBundleRollbackStrategy | null;
  rollbackPackageDigest: string | null;
}

interface NormalizedLegacyBenchmarkReport {
  inputRef: ApplyRollbackArtifactInputRef;
  evaluation: {
    decision: "continue" | "escalate" | "stop";
    reasonCode: string;
    reasonDetail: string;
    qualityFloorPreserved: boolean;
    validGain: boolean;
  };
}

function compareStableStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeOptionalNonEmptyString(value) ?? null;
}

function normalizeStringArray(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode,
  options: { allowEmpty?: boolean } = {}
): string[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const normalizedItem = normalizeOptionalNonEmptyString(item);
    if (!normalizedItem) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}] must be a non-empty string`,
        errorCode
      );
    }

    if (!seen.has(normalizedItem)) {
      seen.add(normalizedItem);
      normalized.push(normalizedItem);
    }
  }

  if (!options.allowEmpty && normalized.length === 0) {
    throw new ApplyRollbackError(`${context} must include at least one item`, errorCode);
  }

  return normalized.sort(compareStableStrings);
}

function normalizeOptionalStringArray(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeStringArray(value, context, errorCode, { allowEmpty: true });
}

function normalizeBoolean(value: unknown, context: string, errorCode: ApplyRollbackErrorCode): boolean {
  if (typeof value !== "boolean") {
    throw new ApplyRollbackError(`${context} must be a boolean`, errorCode);
  }

  return value;
}

function requireStringValue(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): string {
  if (typeof value !== "string") {
    throw new ApplyRollbackError(`${context} must be a string`, errorCode);
  }

  return value;
}

function decodeBase64Content(
  value: string,
  context: string,
  errorCode: ApplyRollbackErrorCode
): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new ApplyRollbackError(
      `${context} must be canonical base64-encoded content`,
      errorCode
    );
  }

  return decoded;
}

function normalizeArtifactInputRef(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): ApplyRollbackArtifactInputRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an object`, errorCode);
  }

  const ref = value as {
    artifact_id?: unknown;
    artifact_type?: unknown;
    schema_version?: unknown;
  };

  const artifactId = normalizeOptionalNonEmptyString(ref.artifact_id);
  const artifactType = normalizeOptionalNonEmptyString(ref.artifact_type);
  const schemaVersion = normalizeOptionalNonEmptyString(ref.schema_version);
  if (!artifactId || !artifactType || !schemaVersion) {
    throw new ApplyRollbackError(
      `${context} must include artifact_id, artifact_type, and schema_version`,
      errorCode
    );
  }

  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    schema_version: schemaVersion
  };
}

function normalizeArtifactInputRefs(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): ApplyRollbackArtifactInputRef[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  return value.map((entry, index) =>
    normalizeArtifactInputRef(entry, `${context}[${String(index)}]`, errorCode)
  );
}

function findSingleInputRefByType(
  refs: ApplyRollbackArtifactInputRef[],
  artifactType: string,
  context: string,
  errorCode: ApplyRollbackErrorCode
): ApplyRollbackArtifactInputRef | undefined {
  const matches = refs.filter((ref) => ref.artifact_type === artifactType);
  if (matches.length > 1) {
    throw new ApplyRollbackError(
      `${context} must not include multiple ${artifactType} references`,
      errorCode
    );
  }

  return matches[0];
}

function buildSha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildSha256Prefixed(value: string | Buffer): string {
  return `sha256:${buildSha256Hex(value)}`;
}

function normalizeDigest(value: unknown, context: string, errorCode: ApplyRollbackErrorCode): string {
  const digest = normalizeOptionalNonEmptyString(value);
  if (!digest) {
    throw new ApplyRollbackError(`${context} must be a non-empty string`, errorCode);
  }

  return digest;
}

function normalizePatchRunVerificationResults(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): PatchRunVerificationResult[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  const seenChecks = new Set<string>();
  const results: PatchRunVerificationResult[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ApplyRollbackError(`${context}[${String(index)}] must be an object`, errorCode);
    }

    const result = item as {
      check?: unknown;
      status?: unknown;
      evidence_ref?: unknown;
      detail?: unknown;
    };

    const check = normalizeOptionalNonEmptyString(result.check);
    if (!check) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}].check must be a non-empty string`,
        errorCode
      );
    }

    if (seenChecks.has(check)) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}].check must be unique`,
        errorCode
      );
    }
    seenChecks.add(check);

    const status = result.status;
    if (status !== "pass" && status !== "fail" && status !== "not_run") {
      throw new ApplyRollbackError(
        `${context}[${String(index)}].status must be pass, fail, or not_run`,
        errorCode
      );
    }

    const evidenceRef = normalizeOptionalNonEmptyString(result.evidence_ref);
    const detail = normalizeOptionalNonEmptyString(result.detail);

    results.push({
      check,
      status: status as PatchRunCheckStatus,
      ...(evidenceRef ? { evidence_ref: evidenceRef } : {}),
      ...(detail ? { detail } : {})
    });
  }

  return results.sort((left, right) => compareStableStrings(left.check, right.check));
}

function normalizeVerificationStringArray(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): string[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  return value.map((item, index) => {
    const normalized = normalizeOptionalNonEmptyString(item);
    if (!normalized) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}] must be a non-empty string`,
        errorCode
      );
    }
    return normalized;
  }).sort(compareStableStrings);
}

function normalizeOrderedStringArray(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): string[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const normalizedItem = normalizeOptionalNonEmptyString(item);
    if (!normalizedItem) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}] must be a non-empty string`,
        errorCode
      );
    }

    if (!seen.has(normalizedItem)) {
      seen.add(normalizedItem);
      normalized.push(normalizedItem);
    }
  }

  return normalized;
}

function normalizePosixRelativePath(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): string {
  const raw = normalizeOptionalNonEmptyString(value);
  if (!raw) {
    throw new ApplyRollbackError(`${context} must be a non-empty string`, errorCode);
  }

  const normalized = posix.normalize(raw.replace(/\\/g, "/"));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new ApplyRollbackError(
      `${context} must be a normalized workspace-relative path`,
      errorCode
    );
  }

  return normalized;
}

function normalizePrBundleEdits(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): NormalizedPrBundleInput["edits"] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  const edits: NormalizedPrBundleInput["edits"] = [];
  const seenPaths = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ApplyRollbackError(`${context}[${String(index)}] must be an object`, errorCode);
    }

    const edit = item as Partial<PrBundleDiffPlanEditSummary>;
    const path = normalizePosixRelativePath(edit.path, `${context}[${String(index)}].path`, errorCode);
    const operation = edit.operation;
    if (operation !== "create" && operation !== "modify" && operation !== "delete") {
      throw new ApplyRollbackError(
        `${context}[${String(index)}].operation must be create, modify, or delete`,
        errorCode
      );
    }

    if (seenPaths.has(path)) {
      throw new ApplyRollbackError(
        `${context} contains duplicate path entries (${path}); deterministic apply/rollback requires one edit per path`,
        errorCode
      );
    }
    seenPaths.add(path);

    const targetId = normalizeOptionalNonEmptyString((edit as { target_id?: unknown }).target_id);
    const symbolPath = (edit as { symbol_path?: unknown }).symbol_path;
    let normalizedSymbolPath: string | null | undefined;
    if (symbolPath === null) {
      normalizedSymbolPath = null;
    } else {
      normalizedSymbolPath = normalizeOptionalNonEmptyString(symbolPath);
    }

    edits.push({
      path,
      operation,
      ...(targetId ? { targetId } : {}),
      ...(normalizedSymbolPath !== undefined ? { symbolPath: normalizedSymbolPath } : {})
    });
  }

  return edits.sort((left, right) => compareStableStrings(left.path, right.path));
}

function normalizePrBundleArtifact(input: unknown): NormalizedPrBundleInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ApplyRollbackError(
      "Apply/rollback requires a PR bundle artifact object",
      "INVALID_PR_BUNDLE"
    );
  }

  const artifact = input as Partial<PrBundleArtifactV1>;
  if (artifact.artifact_type !== PR_BUNDLE_ARTIFACT_TYPE) {
    throw new ApplyRollbackError(
      `Apply/rollback requires ${PR_BUNDLE_ARTIFACT_TYPE} input`,
      "INVALID_PR_BUNDLE"
    );
  }

  if (artifact.schema_version !== PR_BUNDLE_SCHEMA_VERSION) {
    throw new ApplyRollbackError(
      `Apply/rollback requires ${PR_BUNDLE_ARTIFACT_TYPE}@${PR_BUNDLE_SCHEMA_VERSION}`,
      "INVALID_PR_BUNDLE"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new ApplyRollbackError(
      "PR bundle is missing required envelope fields",
      "INVALID_PR_BUNDLE"
    );
  }

  const inputs = normalizeArtifactInputRefs(artifact.inputs, "PR bundle inputs", "INVALID_PR_BUNDLE");
  const patchRunRef = findSingleInputRefByType(
    inputs,
    "ls.m2.patch_run",
    "PR bundle inputs",
    "INVALID_PR_BUNDLE"
  );
  if (!patchRunRef) {
    throw new ApplyRollbackError(
      "PR bundle inputs must include a ls.m2.patch_run reference",
      "INVALID_PR_BUNDLE"
    );
  }

  const trace = artifact.trace as
    | {
        lineage?: unknown;
      }
    | undefined;
  const traceLineage = trace?.lineage === undefined
    ? []
    : normalizeOrderedStringArray(trace.lineage, "PR bundle trace.lineage", "INVALID_PR_BUNDLE");

  const payload = artifact.payload as
    | {
        patch?: {
          format?: unknown;
          digest?: unknown;
          content?: unknown;
          patch_run_artifact_id?: unknown;
        };
        verification?: {
          patch_run_artifact_id?: unknown;
          required_checks?: unknown;
          results?: unknown;
          checks_complete?: unknown;
          evidence_complete?: unknown;
          all_required_passed?: unknown;
          missing_required_checks?: unknown;
          incomplete_checks?: unknown;
          failing_checks?: unknown;
        };
        rollback?: {
          strategy?: unknown;
          supported?: unknown;
          package_ref?: unknown;
          package?: {
            format?: unknown;
            content?: unknown;
            digest?: unknown;
          } | null;
          instructions?: unknown;
        };
        readiness?: {
          decision?: unknown;
          reason_code?: unknown;
          reason_detail?: unknown;
        };
        traceability?: {
          diff_plan_edits?: unknown;
          patch_run_outcome?: {
            decision?: unknown;
            reason_code?: unknown;
            reason_detail?: unknown;
          };
        };
      }
    | undefined;

  const patchFormat = normalizeOptionalNonEmptyString(payload?.patch?.format);
  if (patchFormat !== "unified_diff") {
    throw new ApplyRollbackError(
      "PR bundle payload.patch.format must be unified_diff",
      "INVALID_PR_BUNDLE"
    );
  }

  const patchContent = requireStringValue(
    payload?.patch?.content,
    "PR bundle payload.patch.content",
    "INVALID_PR_BUNDLE"
  );
  const patchDigest = normalizeDigest(payload?.patch?.digest, "PR bundle payload.patch.digest", "INVALID_PR_BUNDLE");
  if (buildSha256Prefixed(patchContent) !== patchDigest) {
    throw new ApplyRollbackError(
      "PR bundle payload.patch.digest does not match payload.patch.content",
      "INVALID_PR_BUNDLE"
    );
  }

  const patchRunArtifactIdFromPatch = normalizeOptionalNonEmptyString(payload?.patch?.patch_run_artifact_id);
  const patchRunArtifactIdFromVerification = normalizeOptionalNonEmptyString(
    payload?.verification?.patch_run_artifact_id
  );
  if (!patchRunArtifactIdFromPatch || !patchRunArtifactIdFromVerification) {
    throw new ApplyRollbackError(
      "PR bundle payload.patch.patch_run_artifact_id and payload.verification.patch_run_artifact_id are required",
      "INVALID_PR_BUNDLE"
    );
  }

  if (patchRunArtifactIdFromPatch !== patchRunArtifactIdFromVerification) {
    throw new ApplyRollbackError(
      "PR bundle patch and verification patch_run_artifact_id values must match",
      "INVALID_PR_BUNDLE"
    );
  }

  if (patchRunArtifactIdFromPatch !== patchRunRef.artifact_id) {
    throw new ApplyRollbackError(
      "PR bundle patch_run_artifact_id must match the ls.m2.patch_run input reference",
      "INVALID_PR_BUNDLE"
    );
  }

  const verificationRequiredChecks = normalizeStringArray(
    payload?.verification?.required_checks,
    "PR bundle payload.verification.required_checks",
    "INVALID_PR_BUNDLE"
  );
  const verificationResults = normalizePatchRunVerificationResults(
    payload?.verification?.results,
    "PR bundle payload.verification.results",
    "INVALID_PR_BUNDLE"
  );
  const checksComplete = normalizeBoolean(
    payload?.verification?.checks_complete,
    "PR bundle payload.verification.checks_complete",
    "INVALID_PR_BUNDLE"
  );
  const evidenceComplete = normalizeBoolean(
    payload?.verification?.evidence_complete,
    "PR bundle payload.verification.evidence_complete",
    "INVALID_PR_BUNDLE"
  );
  const allRequiredPassed = normalizeBoolean(
    payload?.verification?.all_required_passed,
    "PR bundle payload.verification.all_required_passed",
    "INVALID_PR_BUNDLE"
  );
  const missingRequiredChecks = normalizeVerificationStringArray(
    payload?.verification?.missing_required_checks,
    "PR bundle payload.verification.missing_required_checks",
    "INVALID_PR_BUNDLE"
  );
  const incompleteChecks = normalizeVerificationStringArray(
    payload?.verification?.incomplete_checks,
    "PR bundle payload.verification.incomplete_checks",
    "INVALID_PR_BUNDLE"
  );
  const failingChecks = normalizeVerificationStringArray(
    payload?.verification?.failing_checks,
    "PR bundle payload.verification.failing_checks",
    "INVALID_PR_BUNDLE"
  );

  const rollback = payload?.rollback;
  const rollbackSupported = normalizeBoolean(
    rollback?.supported,
    "PR bundle payload.rollback.supported",
    "INVALID_PR_BUNDLE"
  );
  const rollbackStrategyRaw = rollback?.strategy;
  let rollbackStrategy: PrBundleRollbackStrategy | null = null;
  if (rollbackStrategyRaw !== undefined && rollbackStrategyRaw !== null) {
    const normalizedRollbackStrategy = normalizeOptionalNonEmptyString(rollbackStrategyRaw);
    if (!normalizedRollbackStrategy || !PR_BUNDLE_ROLLBACK_STRATEGY_SET.has(normalizedRollbackStrategy)) {
      throw new ApplyRollbackError(
        "PR bundle payload.rollback.strategy is unsupported for the pinned schema version",
        "INVALID_PR_BUNDLE"
      );
    }
    rollbackStrategy = normalizedRollbackStrategy as PrBundleRollbackStrategy;
  }

  const rollbackPackageRef = normalizeOptionalStringOrNull(rollback?.package_ref) ?? null;
  const rollbackInstructions = normalizeOptionalStringArray(
    rollback?.instructions,
    "PR bundle payload.rollback.instructions",
    "INVALID_PR_BUNDLE"
  ) ?? [];
  const rollbackInstructionsPresent = rollbackInstructions.length > 0;

  let rollbackPackageDigest: string | null = null;
  let rollbackPackageFormat: string | null = null;
  let rollbackPackageValid = false;
  if (rollback?.package !== undefined && rollback?.package !== null) {
    if (typeof rollback.package !== "object" || Array.isArray(rollback.package)) {
      throw new ApplyRollbackError(
        "PR bundle payload.rollback.package must be an object when provided",
        "INVALID_PR_BUNDLE"
      );
    }

    const rollbackPackage = rollback.package as {
      format?: unknown;
      content?: unknown;
      digest?: unknown;
    };
    const format = normalizeOptionalNonEmptyString(rollbackPackage.format);
    const content = requireStringValue(
      rollbackPackage.content,
      "PR bundle payload.rollback.package.content",
      "INVALID_PR_BUNDLE"
    );
    const digest = normalizeDigest(
      rollbackPackage.digest,
      "PR bundle payload.rollback.package.digest",
      "INVALID_PR_BUNDLE"
    );

    if (format !== "unified_diff") {
      throw new ApplyRollbackError(
        "PR bundle payload.rollback.package.format must be unified_diff",
        "INVALID_PR_BUNDLE"
      );
    }

    if (buildSha256Prefixed(content) !== digest) {
      throw new ApplyRollbackError(
        "PR bundle payload.rollback.package.digest does not match package.content",
        "INVALID_PR_BUNDLE"
      );
    }

    rollbackPackageDigest = digest;
    rollbackPackageFormat = format;
    rollbackPackageValid = true;
  }

  const readinessDecision = payload?.readiness?.decision;
  if (readinessDecision !== "continue" && readinessDecision !== "stop") {
    throw new ApplyRollbackError(
      "PR bundle payload.readiness.decision must be continue or stop",
      "INVALID_PR_BUNDLE"
    );
  }
  const readinessReasonCode = normalizeOptionalNonEmptyString(payload?.readiness?.reason_code);
  const readinessReasonDetail = normalizeOptionalNonEmptyString(payload?.readiness?.reason_detail);
  if (!readinessReasonCode || !readinessReasonDetail) {
    throw new ApplyRollbackError(
      "PR bundle payload.readiness.reason_code and reason_detail are required",
      "INVALID_PR_BUNDLE"
    );
  }
  if (!PR_BUNDLE_REASON_CODE_SET.has(readinessReasonCode)) {
    throw new ApplyRollbackError(
      "PR bundle payload.readiness.reason_code is unsupported for the pinned schema version",
      "INVALID_PR_BUNDLE"
    );
  }

  const patchRunOutcomeDecision = payload?.traceability?.patch_run_outcome?.decision;
  if (
    patchRunOutcomeDecision !== "continue" &&
    patchRunOutcomeDecision !== "escalate" &&
    patchRunOutcomeDecision !== "stop"
  ) {
    throw new ApplyRollbackError(
      "PR bundle payload.traceability.patch_run_outcome.decision must be continue, escalate, or stop",
      "INVALID_PR_BUNDLE"
    );
  }

  const patchRunOutcomeReasonCode = normalizeOptionalNonEmptyString(
    payload?.traceability?.patch_run_outcome?.reason_code
  );
  const patchRunOutcomeReasonDetail = normalizeOptionalNonEmptyString(
    payload?.traceability?.patch_run_outcome?.reason_detail
  );
  if (!patchRunOutcomeReasonCode || !patchRunOutcomeReasonDetail) {
    throw new ApplyRollbackError(
      "PR bundle payload.traceability.patch_run_outcome.reason_code and reason_detail are required",
      "INVALID_PR_BUNDLE"
    );
  }
  if (!PATCH_RUN_REASON_CODE_SET.has(patchRunOutcomeReasonCode)) {
    throw new ApplyRollbackError(
      "PR bundle payload.traceability.patch_run_outcome.reason_code is unsupported for the pinned schema version",
      "INVALID_PR_BUNDLE"
    );
  }

  const edits = normalizePrBundleEdits(
    payload?.traceability?.diff_plan_edits,
    "PR bundle payload.traceability.diff_plan_edits",
    "INVALID_PR_BUNDLE"
  );

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: PR_BUNDLE_ARTIFACT_TYPE,
      schema_version: PR_BUNDLE_SCHEMA_VERSION
    },
    runId,
    traceLineage,
    patchRunRef,
    patchDigest,
    patchContent,
    patchFormat,
    patchRunArtifactIdFromPayload: patchRunArtifactIdFromPatch,
    verification: {
      patch_run_artifact_id: patchRunArtifactIdFromPatch,
      pr_bundle_ready: readinessDecision === "continue",
      pr_bundle_readiness: {
        decision: readinessDecision,
        reason_code: readinessReasonCode,
        reason_detail: readinessReasonDetail
      },
      patch_run_outcome: {
        decision: patchRunOutcomeDecision as PatchRunDecision,
        reason_code: patchRunOutcomeReasonCode,
        reason_detail: patchRunOutcomeReasonDetail
      },
      required_checks: verificationRequiredChecks,
      results: verificationResults,
      checks_complete: checksComplete,
      evidence_complete: evidenceComplete,
      all_required_passed: allRequiredPassed,
      missing_required_checks: missingRequiredChecks,
      incomplete_checks: incompleteChecks,
      failing_checks: failingChecks
    },
    rollback: {
      available:
        rollbackSupported &&
        !!rollbackStrategy &&
        !!rollbackPackageRef &&
        rollbackPackageValid &&
        rollbackInstructionsPresent,
      strategy: rollbackStrategy,
      packageRef: rollbackPackageRef,
      packageDigest: rollbackPackageDigest,
      packageFormat: rollbackPackageFormat,
      packageValid: rollbackPackageValid,
      instructionsPresent: rollbackInstructionsPresent
    },
    readiness: {
      decision: readinessDecision,
      reasonCode: readinessReasonCode,
      reasonDetail: readinessReasonDetail
    },
    patchRunOutcome: {
      decision: patchRunOutcomeDecision as PatchRunDecision,
      reasonCode: patchRunOutcomeReasonCode,
      reasonDetail: patchRunOutcomeReasonDetail
    },
    edits
  };
}

function normalizeSnapshotFileEntries(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): ApplyRollbackFileSnapshotEntry[] {
  if (!Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an array`, errorCode);
  }

  const entries: ApplyRollbackFileSnapshotEntry[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ApplyRollbackError(`${context}[${String(index)}] must be an object`, errorCode);
    }

    const entry = item as {
      path?: unknown;
      exists?: unknown;
      byte_length?: unknown;
      content_sha256?: unknown;
      content_base64?: unknown;
    };

    const path = normalizePosixRelativePath(entry.path, `${context}[${String(index)}].path`, errorCode);
    if (seen.has(path)) {
      throw new ApplyRollbackError(`${context} contains duplicate path entries (${path})`, errorCode);
    }
    seen.add(path);

    const exists = normalizeBoolean(entry.exists, `${context}[${String(index)}].exists`, errorCode);
    const byteLengthValue = entry.byte_length;
    if (!Number.isInteger(byteLengthValue) || (byteLengthValue as number) < 0) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}].byte_length must be a non-negative integer`,
        errorCode
      );
    }

    const contentSha = entry.content_sha256;
    const contentBase64 = entry.content_base64;
    if (!exists) {
      if (contentSha !== null || contentBase64 !== null) {
        throw new ApplyRollbackError(
          `${context}[${String(index)}] must set content_sha256/content_base64 to null when exists=false`,
          errorCode
        );
      }
    }

    const normalizedSha =
      contentSha === null
        ? null
        : normalizeDigest(contentSha, `${context}[${String(index)}].content_sha256`, errorCode);
    const normalizedBase64 =
      contentBase64 === null
        ? null
        : requireStringValue(contentBase64, `${context}[${String(index)}].content_base64`, errorCode);

    if (exists && (!normalizedSha || normalizedBase64 === null)) {
      throw new ApplyRollbackError(
        `${context}[${String(index)}] must include content_sha256 and content_base64 when exists=true`,
        errorCode
      );
    }

    if (exists && normalizedSha && normalizedBase64 !== null) {
      const decoded = decodeBase64Content(
        normalizedBase64,
        `${context}[${String(index)}].content_base64`,
        errorCode
      );
      if (decoded.byteLength !== (byteLengthValue as number)) {
        throw new ApplyRollbackError(
          `${context}[${String(index)}].content_base64 decoded byte length does not match byte_length`,
          errorCode
        );
      }

      if (buildSha256Prefixed(decoded) !== normalizedSha) {
        throw new ApplyRollbackError(
          `${context}[${String(index)}].content_base64 decoded content does not match content_sha256`,
          errorCode
        );
      }
    }

    entries.push({
      path,
      exists,
      byte_length: byteLengthValue as number,
      content_sha256: normalizedSha,
      content_base64: normalizedBase64
    });
  }

  return entries.sort((left, right) => compareStableStrings(left.path, right.path));
}

function buildStateSnapshotDigest(files: ApplyRollbackFileSnapshotEntry[]): string {
  return buildSha256Prefixed(
    JSON.stringify(
      files.map((entry) => ({
        path: entry.path,
        exists: entry.exists,
        byte_length: entry.byte_length,
        content_sha256: entry.content_sha256
      }))
    )
  );
}

function normalizeStateSnapshot(
  value: unknown,
  context: string,
  errorCode: ApplyRollbackErrorCode
): ApplyRollbackStateSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplyRollbackError(`${context} must be an object`, errorCode);
  }

  const snapshot = value as {
    digest?: unknown;
    files?: unknown;
  };
  const files = normalizeSnapshotFileEntries(snapshot.files, `${context}.files`, errorCode);
  const digest = normalizeDigest(snapshot.digest, `${context}.digest`, errorCode);
  if (buildStateSnapshotDigest(files) !== digest) {
    throw new ApplyRollbackError(`${context}.digest does not match ${context}.files`, errorCode);
  }

  return { digest, files };
}

function normalizePreviousApplyRecord(input: unknown): NormalizedPreviousApplyRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ApplyRollbackError(
      "Rollback requires a prior apply/rollback record artifact object",
      "INVALID_PREVIOUS_RECORD"
    );
  }

  const artifact = input as Partial<ApplyRollbackArtifactV1>;
  if (artifact.artifact_type !== APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE) {
    throw new ApplyRollbackError(
      `Rollback requires ${APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE} input`,
      "INVALID_PREVIOUS_RECORD"
    );
  }

  if (artifact.schema_version !== APPLY_ROLLBACK_RECORD_SCHEMA_VERSION) {
    throw new ApplyRollbackError(
      `Rollback requires ${APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE}@${APPLY_ROLLBACK_RECORD_SCHEMA_VERSION}`,
      "INVALID_PREVIOUS_RECORD"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new ApplyRollbackError(
      "Previous apply record is missing required envelope fields",
      "INVALID_PREVIOUS_RECORD"
    );
  }

  const payload = artifact.payload as
    | {
        action?: unknown;
        decision?: unknown;
        traceability?: {
          pr_bundle_artifact_id?: unknown;
        };
        target_state?: {
          changed_paths?: unknown;
        };
        execution?: {
          state_before?: unknown;
          state_after?: unknown;
        };
        rollback?: {
          available?: unknown;
          strategy?: unknown;
          package_digest?: unknown;
        };
      }
    | undefined;

  if (payload?.action !== "apply") {
    throw new ApplyRollbackError(
      "Previous apply record payload.action must be apply",
      "INVALID_PREVIOUS_RECORD"
    );
  }

  if (payload?.decision !== "continue") {
    throw new ApplyRollbackError(
      "Previous apply record payload.decision must be continue for rollback",
      "INVALID_PREVIOUS_RECORD"
    );
  }

  const prBundleArtifactId = normalizeOptionalNonEmptyString(payload?.traceability?.pr_bundle_artifact_id);
  if (!prBundleArtifactId) {
    throw new ApplyRollbackError(
      "Previous apply record traceability.pr_bundle_artifact_id is required",
      "INVALID_PREVIOUS_RECORD"
    );
  }

  const changedPaths = normalizeVerificationStringArray(
    payload?.target_state?.changed_paths,
    "Previous apply record payload.target_state.changed_paths",
    "INVALID_PREVIOUS_RECORD"
  );

  const stateBefore = normalizeStateSnapshot(
    payload?.execution?.state_before,
    "Previous apply record payload.execution.state_before",
    "INVALID_PREVIOUS_RECORD"
  );
  const stateAfter = normalizeStateSnapshot(
    payload?.execution?.state_after,
    "Previous apply record payload.execution.state_after",
    "INVALID_PREVIOUS_RECORD"
  );

  const rollbackAvailable = normalizeBoolean(
    payload?.rollback?.available,
    "Previous apply record payload.rollback.available",
    "INVALID_PREVIOUS_RECORD"
  );

  const rollbackStrategyRaw = payload?.rollback?.strategy;
  let rollbackStrategy: PrBundleRollbackStrategy | null = null;
  if (rollbackStrategyRaw !== null && rollbackStrategyRaw !== undefined) {
    const normalizedStrategy = normalizeOptionalNonEmptyString(rollbackStrategyRaw);
    if (!normalizedStrategy || !PR_BUNDLE_ROLLBACK_STRATEGY_SET.has(normalizedStrategy)) {
      throw new ApplyRollbackError(
        "Previous apply record payload.rollback.strategy is unsupported",
        "INVALID_PREVIOUS_RECORD"
      );
    }
    rollbackStrategy = normalizedStrategy as PrBundleRollbackStrategy;
  }

  const rollbackPackageDigest = normalizeOptionalStringOrNull(payload?.rollback?.package_digest) ?? null;

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE,
      schema_version: APPLY_ROLLBACK_RECORD_SCHEMA_VERSION
    },
    runId,
    prBundleArtifactId,
    stateBefore,
    stateAfter,
    changedPaths,
    rollbackAvailable,
    rollbackStrategy,
    rollbackPackageDigest
  };
}

function normalizeLegacyBenchmarkReport(input: unknown): NormalizedLegacyBenchmarkReport {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ApplyRollbackError(
      "Benchmark report must be an artifact object when provided",
      "INVALID_BENCHMARK_REPORT"
    );
  }

  const artifact = input as {
    artifact_type?: unknown;
    schema_version?: unknown;
    artifact_id?: unknown;
    payload?: {
      m2_objective_evaluation?: {
        decision?: unknown;
        reason_code?: unknown;
        reason_detail?: unknown;
        quality_floor_preserved?: unknown;
        valid_gain?: unknown;
      };
    };
  };

  if (artifact.artifact_type !== LEGACY_BENCHMARK_REPORT_ARTIFACT_TYPE) {
    throw new ApplyRollbackError(
      `Benchmark report must be ${LEGACY_BENCHMARK_REPORT_ARTIFACT_TYPE}`,
      "INVALID_BENCHMARK_REPORT"
    );
  }
  if (artifact.schema_version !== LEGACY_BENCHMARK_REPORT_SCHEMA_VERSION) {
    throw new ApplyRollbackError(
      `Benchmark report must be ${LEGACY_BENCHMARK_REPORT_ARTIFACT_TYPE}@${LEGACY_BENCHMARK_REPORT_SCHEMA_VERSION}`,
      "INVALID_BENCHMARK_REPORT"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const evaluation = artifact.payload?.m2_objective_evaluation;
  const decision = evaluation?.decision;
  if (decision !== "continue" && decision !== "escalate" && decision !== "stop") {
    throw new ApplyRollbackError(
      "Benchmark report payload.m2_objective_evaluation.decision must be continue, escalate, or stop",
      "INVALID_BENCHMARK_REPORT"
    );
  }
  const reasonCode = normalizeOptionalNonEmptyString(evaluation?.reason_code);
  const reasonDetail = normalizeOptionalNonEmptyString(evaluation?.reason_detail);
  if (!artifactId || !reasonCode || !reasonDetail) {
    throw new ApplyRollbackError(
      "Benchmark report artifact_id and m2_objective_evaluation reason fields are required",
      "INVALID_BENCHMARK_REPORT"
    );
  }

  const qualityFloorPreserved = normalizeBoolean(
    evaluation?.quality_floor_preserved,
    "Benchmark report payload.m2_objective_evaluation.quality_floor_preserved",
    "INVALID_BENCHMARK_REPORT"
  );
  const validGain = normalizeBoolean(
    evaluation?.valid_gain,
    "Benchmark report payload.m2_objective_evaluation.valid_gain",
    "INVALID_BENCHMARK_REPORT"
  );

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: LEGACY_BENCHMARK_REPORT_ARTIFACT_TYPE,
      schema_version: LEGACY_BENCHMARK_REPORT_SCHEMA_VERSION
    },
    evaluation: {
      decision,
      reasonCode,
      reasonDetail,
      qualityFloorPreserved,
      validGain
    }
  };
}

function normalizeAction(value: unknown): ApplyRollbackAction {
  if (value !== "apply" && value !== "rollback") {
    throw new ApplyRollbackError(
      "Apply/rollback action must be apply or rollback",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeWorkspaceRoot(value: unknown): string {
  const workspaceRoot = normalizeOptionalNonEmptyString(value);
  if (!workspaceRoot) {
    throw new ApplyRollbackError(
      "Apply/rollback workspaceRoot must be a non-empty string",
      "INVALID_OPTIONS"
    );
  }

  const resolved = resolve(workspaceRoot);
  if (!existsSync(resolved)) {
    throw new ApplyRollbackError(
      `Apply/rollback workspaceRoot does not exist: ${resolved}`,
      "INVALID_OPTIONS"
    );
  }

  let stats;
  try {
    stats = statSync(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApplyRollbackError(
      `Apply/rollback workspaceRoot is not readable: ${message}`,
      "INVALID_OPTIONS"
    );
  }

  if (!stats.isDirectory()) {
    throw new ApplyRollbackError(
      "Apply/rollback workspaceRoot must point to a directory",
      "INVALID_OPTIONS"
    );
  }

  return resolved;
}

function normalizeExecute(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new ApplyRollbackError("Apply/rollback execute must be a boolean when provided", "INVALID_OPTIONS");
  }

  return value;
}

function normalizeActionAllowed(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "boolean") {
    throw new ApplyRollbackError("Apply/rollback allowAction must be a boolean when provided", "INVALID_OPTIONS");
  }

  return value;
}

function normalizeApprovalRequired(value: unknown, action: ApplyRollbackAction): boolean {
  if (value === undefined) {
    return action === "apply";
  }

  if (typeof value !== "boolean") {
    throw new ApplyRollbackError(
      "Apply/rollback approvalRequired must be a boolean when provided",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeDeclaredCapabilities(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  return normalizeStringArray(value, "Apply/rollback declaredCapabilities", "INVALID_OPTIONS", {
    allowEmpty: true
  });
}

function normalizePolicyRef(value: unknown, fallback: string, context: string): string {
  const normalized = normalizeOptionalNonEmptyString(value);
  return normalized ?? fallback;
}

function normalizeTargetWorkspaceRef(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeOptionalStringOrNull(value) ?? null;
}

function normalizeExpectedTargetStateDigest(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeOptionalStringOrNull(value) ?? null;
}

function normalizeRequireBenchmarkValidGain(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new ApplyRollbackError(
      "Apply/rollback requireBenchmarkValidGain must be a boolean when provided",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizePathPatterns(
  value: unknown,
  defaults: readonly string[],
  context: string
): string[] {
  if (value === undefined) {
    return [...defaults].sort(compareStableStrings);
  }

  const patterns = normalizeStringArray(value, context, "INVALID_OPTIONS", { allowEmpty: true });
  return patterns.sort(compareStableStrings);
}

function resolveRequiredCapability(action: ApplyRollbackAction): string {
  return action === "apply" ? DEFAULT_APPLY_REQUIRED_CAPABILITY : DEFAULT_ROLLBACK_REQUIRED_CAPABILITY;
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function globPatternToRegex(pattern: string): RegExp {
  const cached = PATH_GLOB_REGEX_CACHE.get(pattern);
  if (cached) {
    return cached;
  }

  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    if (character === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        const afterGlobStar = pattern[index + 2];
        if (afterGlobStar === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }

    expression += escapeRegexCharacter(character);
  }

  expression += "$";
  const compiled = new RegExp(expression);
  PATH_GLOB_REGEX_CACHE.set(pattern, compiled);
  return compiled;
}

function collectMatchingPaths(paths: string[], patterns: string[]): string[] {
  const matches = new Set<string>();

  for (const candidate of paths) {
    for (const pattern of patterns) {
      if (
        globPatternToRegex(pattern).test(candidate) ||
        (pattern.endsWith("/**") && candidate === pattern.slice(0, -3))
      ) {
        matches.add(candidate);
        break;
      }
    }
  }

  return [...matches].sort(compareStableStrings);
}

function toAbsoluteWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  const absolute = join(workspaceRoot, ...segments);
  const resolvedAbsolute = resolve(absolute);
  const rootPrefix = workspaceRoot.endsWith(sep) ? workspaceRoot : `${workspaceRoot}${sep}`;
  if (resolvedAbsolute !== workspaceRoot && !resolvedAbsolute.startsWith(rootPrefix)) {
    throw new ApplyRollbackError(
      `Resolved workspace path escapes workspaceRoot: ${relativePath}`,
      "EXECUTION_FAILED"
    );
  }

  return resolvedAbsolute;
}

function readWorkspaceFileSnapshotEntry(
  workspaceRoot: string,
  relativePath: string
): ApplyRollbackFileSnapshotEntry {
  const absolutePath = toAbsoluteWorkspacePath(workspaceRoot, relativePath);

  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false,
      byte_length: 0,
      content_sha256: null,
      content_base64: null
    };
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new ApplyRollbackError(
      `Apply/rollback supports file paths only; ${relativePath} is not a regular file`,
      "EXECUTION_FAILED"
    );
  }

  const content = readFileSync(absolutePath);
  return {
    path: relativePath,
    exists: true,
    byte_length: content.byteLength,
    content_sha256: buildSha256Prefixed(content),
    content_base64: content.toString("base64")
  };
}

function captureWorkspaceStateSnapshot(
  workspaceRoot: string,
  changedPaths: string[]
): ApplyRollbackStateSnapshot {
  const files = changedPaths.map((path) => readWorkspaceFileSnapshotEntry(workspaceRoot, path));
  files.sort((left, right) => compareStableStrings(left.path, right.path));

  return {
    digest: buildStateSnapshotDigest(files),
    files
  };
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function buildDeterministicAppliedContent(params: {
  edit: NormalizedPrBundleInput["edits"][number];
  prBundleArtifactId: string;
  patchRunArtifactId: string;
  patchDigest: string;
  action: ApplyRollbackAction;
}): string {
  const symbolLabel =
    params.edit.symbolPath === undefined
      ? "symbol:unspecified"
      : params.edit.symbolPath === null
        ? "symbol:file"
        : `symbol:${params.edit.symbolPath}`;
  const targetLabel = params.edit.targetId ? `target:${params.edit.targetId}` : "target:none";

  return [
    "# l-semantica M2 deterministic apply/rollback placeholder",
    `action:${params.action}`,
    `operation:${params.edit.operation}`,
    `path:${params.edit.path}`,
    `pr_bundle:${params.prBundleArtifactId}`,
    `patch_run:${params.patchRunArtifactId}`,
    `patch_digest:${params.patchDigest}`,
    targetLabel,
    symbolLabel
  ].join("\n") + "\n";
}

function validateApplyOperationPreconditions(
  stateBefore: ApplyRollbackStateSnapshot,
  edits: NormalizedPrBundleInput["edits"]
): string | null {
  const byPath = new Map(stateBefore.files.map((entry) => [entry.path, entry]));

  for (const edit of edits) {
    const entry = byPath.get(edit.path);
    if (!entry) {
      return `Target state snapshot is missing path ${edit.path}.`;
    }

    if (edit.operation === "create" && entry.exists) {
      return `Apply create precondition failed because ${edit.path} already exists.`;
    }

    if ((edit.operation === "modify" || edit.operation === "delete") && !entry.exists) {
      return `Apply ${edit.operation} precondition failed because ${edit.path} does not exist.`;
    }
  }

  return null;
}

function applyEditsToWorkspace(
  workspaceRoot: string,
  prBundle: NormalizedPrBundleInput,
  action: ApplyRollbackAction
): void {
  for (const edit of prBundle.edits) {
    const absolutePath = toAbsoluteWorkspacePath(workspaceRoot, edit.path);

    if (edit.operation === "delete") {
      if (existsSync(absolutePath)) {
        rmSync(absolutePath, { force: true });
      }
      continue;
    }

    ensureParentDirectory(absolutePath);
    const content = buildDeterministicAppliedContent({
      edit,
      prBundleArtifactId: prBundle.inputRef.artifact_id,
      patchRunArtifactId: prBundle.patchRunRef.artifact_id,
      patchDigest: prBundle.patchDigest,
      action
    });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function restoreWorkspaceStateSnapshot(workspaceRoot: string, snapshot: ApplyRollbackStateSnapshot): void {
  for (const file of snapshot.files) {
    const absolutePath = toAbsoluteWorkspacePath(workspaceRoot, file.path);

    if (!file.exists) {
      if (existsSync(absolutePath)) {
        rmSync(absolutePath, { force: true });
      }
      continue;
    }

    if (file.content_base64 === null) {
      throw new ApplyRollbackError(
        `Rollback snapshot for ${file.path} is missing content_base64`,
        "INVALID_PREVIOUS_RECORD"
      );
    }

    const decoded = decodeBase64Content(
      file.content_base64,
      `rollback snapshot ${file.path}.content_base64`,
      "INVALID_PREVIOUS_RECORD"
    );
    if (decoded.byteLength !== file.byte_length) {
      throw new ApplyRollbackError(
        `Rollback snapshot ${file.path} byte_length does not match decoded content`,
        "INVALID_PREVIOUS_RECORD"
      );
    }
    if (buildSha256Prefixed(decoded) !== file.content_sha256) {
      throw new ApplyRollbackError(
        `Rollback snapshot ${file.path} content_sha256 does not match decoded content`,
        "INVALID_PREVIOUS_RECORD"
      );
    }

    ensureParentDirectory(absolutePath);
    writeFileSync(absolutePath, decoded);
  }
}

function dedupeStable(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function buildInputs(params: {
  prBundle: NormalizedPrBundleInput;
  previousApplyRecord?: NormalizedPreviousApplyRecord;
  benchmarkReport?: NormalizedLegacyBenchmarkReport;
}): ApplyRollbackArtifactInputRef[] {
  const refs: ApplyRollbackArtifactInputRef[] = [params.prBundle.inputRef];
  if (params.previousApplyRecord) {
    refs.push(params.previousApplyRecord.inputRef);
  }
  if (params.benchmarkReport) {
    refs.push(params.benchmarkReport.inputRef);
  }
  return refs;
}

function buildTraceLineage(params: {
  prBundle: NormalizedPrBundleInput;
  previousApplyRecord?: NormalizedPreviousApplyRecord;
  benchmarkReport?: NormalizedLegacyBenchmarkReport;
}): string[] {
  const ordered = [
    ...params.prBundle.traceLineage,
    params.prBundle.patchRunRef.artifact_id,
    params.prBundle.inputRef.artifact_id,
    params.previousApplyRecord?.inputRef.artifact_id,
    params.benchmarkReport?.inputRef.artifact_id
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return dedupeStable(ordered);
}

function createRunIdFallback(): string {
  try {
    const generated = randomUUID();
    const normalized = generated.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  } catch {}

  return `run-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRunId(preferredRunId: string, runIdFactory?: () => string): string {
  if (typeof runIdFactory === "function") {
    try {
      const candidate = runIdFactory();
      const normalized = normalizeOptionalNonEmptyString(candidate);
      if (normalized) {
        return normalized;
      }
    } catch {}
  }

  return preferredRunId || createRunIdFallback();
}

function resolveProducedAtUtc(now?: () => Date): string {
  if (typeof now === "function") {
    try {
      const candidate = now();
      if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
        return candidate.toISOString();
      }
    } catch {}
  }

  return new Date().toISOString();
}

function resolveToolVersion(value: unknown): string {
  return normalizeOptionalNonEmptyString(value) ?? DEFAULT_APPLY_ROLLBACK_TOOL_VERSION;
}

function buildArtifactDigest(input: {
  inputs: ApplyRollbackArtifactInputRef[];
  trace: ApplyRollbackArtifactV1["trace"];
  payload: ApplyRollbackArtifactV1["payload"];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inputs: input.inputs,
        trace: input.trace,
        payload: input.payload
      })
    )
    .digest("hex");
}

function buildPolicySummary(params: {
  action: ApplyRollbackAction;
  allowAction: boolean;
  approvalRequired: boolean;
  approvalEvidenceRef: string | null;
  declaredCapabilities: string[];
  changedPaths: string[];
  blockedPathPatterns: string[];
  escalationPathPatterns: string[];
}): ApplyRollbackArtifactV1["payload"]["policy"] {
  const requiredCapability = resolveRequiredCapability(params.action);
  const missingCapabilities = params.declaredCapabilities.includes(requiredCapability)
    ? []
    : [requiredCapability];

  const blockedPaths = collectMatchingPaths(params.changedPaths, params.blockedPathPatterns);
  const escalationPaths = collectMatchingPaths(params.changedPaths, params.escalationPathPatterns);

  return {
    action_allowed: params.allowAction,
    approval_required: params.approvalRequired,
    approval_evidence_ref: params.approvalEvidenceRef,
    required_capability: requiredCapability,
    declared_capabilities: [...params.declaredCapabilities].sort(compareStableStrings),
    missing_capabilities: missingCapabilities,
    blocked_paths: blockedPaths,
    escalation_paths: escalationPaths
  };
}

function decideFromUpstreamArtifacts(
  action: ApplyRollbackAction,
  prBundle: NormalizedPrBundleInput
): ApplyRollbackStageDecision | null {
  if (prBundle.patchRunOutcome.decision !== "continue") {
    const reasonCode = APPLY_ROLLBACK_REASON_CODE_SET.has(prBundle.patchRunOutcome.reasonCode)
      ? (prBundle.patchRunOutcome.reasonCode as ApplyRollbackReasonCode)
      : "unsupported_input";
    return {
      decision: prBundle.patchRunOutcome.decision,
      reasonCode,
      reasonDetail: `Upstream patch run outcome blocks ${action}: ${prBundle.patchRunOutcome.reasonDetail}`
    };
  }

  if (prBundle.readiness.decision !== "continue") {
    const reasonCode = APPLY_ROLLBACK_REASON_CODE_SET.has(prBundle.readiness.reasonCode)
      ? (prBundle.readiness.reasonCode as ApplyRollbackReasonCode)
      : "bundle_incomplete";
    return {
      decision: "stop",
      reasonCode,
      reasonDetail: `PR bundle readiness blocks ${action}: ${prBundle.readiness.reasonDetail}`
    };
  }

  return null;
}

function decideFromVerification(
  action: ApplyRollbackAction,
  verification: NormalizedPrBundleInput["verification"]
): ApplyRollbackStageDecision | null {
  if (!verification.checks_complete || !verification.evidence_complete) {
    const pieces: string[] = [];
    if (verification.missing_required_checks.length > 0) {
      pieces.push(`missing required checks: ${verification.missing_required_checks.join(", ")}`);
    }
    if (verification.incomplete_checks.length > 0) {
      pieces.push(`incomplete checks: ${verification.incomplete_checks.join(", ")}`);
    }

    return {
      decision: "stop",
      reasonCode: "verification_incomplete",
      reasonDetail:
        pieces.length > 0
          ? `Required verification evidence is incomplete for ${action}: ${pieces.join("; ")}.`
          : `Required verification evidence is incomplete for ${action}.`
    };
  }

  if (!verification.all_required_passed) {
    return {
      decision: "stop",
      reasonCode: "verification_failed",
      reasonDetail:
        verification.failing_checks.length > 0
          ? `Required verification checks failed for ${action}: ${verification.failing_checks.join(", ")}.`
          : `Required verification checks failed for ${action}.`
    };
  }

  return null;
}

function decideFromRollbackAvailability(
  action: ApplyRollbackAction,
  prBundle: NormalizedPrBundleInput
): ApplyRollbackStageDecision | null {
  if (action === "apply" && !prBundle.rollback.available) {
    return {
      decision: "stop",
      reasonCode: "rollback_unavailable",
      reasonDetail:
        "Apply is blocked because PR bundle rollback support is unavailable, invalid, or incomplete."
    };
  }

  return null;
}

function decideFromBenchmarkGate(
  action: ApplyRollbackAction,
  benchmarkReport: NormalizedLegacyBenchmarkReport | undefined,
  enforce: boolean
): { decision: ApplyRollbackStageDecision | null; summary: ApplyRollbackBenchmarkGateSummary | null } {
  if (!benchmarkReport) {
    return { decision: null, summary: null };
  }

  const summary: ApplyRollbackBenchmarkGateSummary = {
    benchmark_artifact_id: benchmarkReport.inputRef.artifact_id,
    decision: benchmarkReport.evaluation.decision,
    reason_code: benchmarkReport.evaluation.reasonCode,
    reason_detail: benchmarkReport.evaluation.reasonDetail,
    quality_floor_preserved: benchmarkReport.evaluation.qualityFloorPreserved,
    valid_gain: benchmarkReport.evaluation.validGain,
    enforced: enforce
  };

  if (!enforce || action !== "apply") {
    return { decision: null, summary };
  }

  if (!benchmarkReport.evaluation.qualityFloorPreserved) {
    return {
      decision: {
        decision: "stop",
        reasonCode: "benchmark_quality_floor_failed",
        reasonDetail:
          "Apply is blocked because benchmark evidence reports quality_floor_preserved=false for the M2 objective evaluation."
      },
      summary
    };
  }

  if (!benchmarkReport.evaluation.validGain) {
    return {
      decision: {
        decision: "stop",
        reasonCode: "benchmark_invalid_gain",
        reasonDetail:
          "Apply is blocked because benchmark evidence reports valid_gain=false for the M2 objective evaluation."
      },
      summary
    };
  }

  return { decision: null, summary };
}

function decideFromPolicy(
  action: ApplyRollbackAction,
  policy: ApplyRollbackArtifactV1["payload"]["policy"]
): ApplyRollbackStageDecision | null {
  if (!policy.action_allowed) {
    return {
      decision: "stop",
      reasonCode: "policy_blocked",
      reasonDetail: `Policy blocks ${action} for the selected target workspace.`
    };
  }

  if (policy.missing_capabilities.length > 0) {
    return {
      decision: "escalate",
      reasonCode: "undeclared_capability",
      reasonDetail:
        `Apply/rollback requires declared capability ${policy.missing_capabilities.join(", ")} before ${action} can proceed.`
    };
  }

  if (policy.approval_required && !policy.approval_evidence_ref) {
    return {
      decision: "escalate",
      reasonCode: "policy_blocked",
      reasonDetail: `Explicit approval evidence is required before ${action} can proceed.`
    };
  }

  if (policy.blocked_paths.length > 0) {
    return {
      decision: "stop",
      reasonCode: "policy_blocked",
      reasonDetail:
        `Apply/rollback targets blocked paths and cannot proceed autonomously: ${policy.blocked_paths.join(", ")}.`
    };
  }

  if (policy.escalation_paths.length > 0) {
    return {
      decision: "escalate",
      reasonCode: "policy_blocked",
      reasonDetail:
        `Apply/rollback targets policy-sensitive paths requiring human review: ${policy.escalation_paths.join(", ")}.`
    };
  }

  return null;
}

function decideFromRollbackInputs(
  prBundle: NormalizedPrBundleInput,
  previousApplyRecord: NormalizedPreviousApplyRecord | undefined
): ApplyRollbackStageDecision | null {
  if (!previousApplyRecord) {
    return {
      decision: "stop",
      reasonCode: "prior_apply_record_missing",
      reasonDetail: "Rollback requires a prior apply record artifact for the same PR bundle."
    };
  }

  if (previousApplyRecord.prBundleArtifactId !== prBundle.inputRef.artifact_id) {
    return {
      decision: "stop",
      reasonCode: "conflict_detected",
      reasonDetail:
        `Rollback prior apply record references PR bundle ${previousApplyRecord.prBundleArtifactId}, but current input is ${prBundle.inputRef.artifact_id}.`
    };
  }

  if (!previousApplyRecord.rollbackAvailable || !previousApplyRecord.rollbackStrategy) {
    return {
      decision: "stop",
      reasonCode: "rollback_unavailable",
      reasonDetail: "Rollback prior apply record does not include a usable rollback strategy or restore snapshot."
    };
  }

  if (
    prBundle.rollback.packageDigest &&
    previousApplyRecord.rollbackPackageDigest &&
    prBundle.rollback.packageDigest !== previousApplyRecord.rollbackPackageDigest
  ) {
    return {
      decision: "stop",
      reasonCode: "conflict_detected",
      reasonDetail: "Rollback package digest does not match the prior apply record."
    };
  }

  if (prBundle.rollback.strategy && previousApplyRecord.rollbackStrategy !== prBundle.rollback.strategy) {
    return {
      decision: "stop",
      reasonCode: "conflict_detected",
      reasonDetail: "Rollback strategy does not match the prior apply record."
    };
  }

  return null;
}

function snapshotsCoverChangedPaths(snapshot: ApplyRollbackStateSnapshot, changedPaths: string[]): boolean {
  const snapshotPaths = new Set(snapshot.files.map((entry) => entry.path));
  return changedPaths.every((path) => snapshotPaths.has(path));
}

function createEmptyDecision(): ApplyRollbackStageDecision {
  return {
    decision: "continue",
    reasonCode: "ok",
    reasonDetail: "All apply/rollback policy, verification, and precondition checks passed."
  };
}

function cloneSnapshot(snapshot: ApplyRollbackStateSnapshot): ApplyRollbackStateSnapshot {
  return {
    digest: snapshot.digest,
    files: snapshot.files.map((file) => ({ ...file }))
  };
}

export function createApplyRollbackRecordArtifact(
  options: CreateApplyRollbackRecordArtifactOptions
): ApplyRollbackArtifactV1 {
  if (typeof options !== "object" || options === null) {
    throw new ApplyRollbackError("Apply/rollback options must be an object", "INVALID_OPTIONS");
  }

  const action = normalizeAction(options.action);
  const prBundle = normalizePrBundleArtifact(options.prBundle);
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot);
  const execute = normalizeExecute(options.execute);
  const allowAction = normalizeActionAllowed(options.allowAction);
  const approvalRequired = normalizeApprovalRequired(options.approvalRequired, action);
  const approvalEvidenceRef = normalizeOptionalStringOrNull(options.approvalEvidenceRef) ?? null;
  const declaredCapabilities = normalizeDeclaredCapabilities(options.declaredCapabilities);
  const expectedTargetStateDigest = normalizeExpectedTargetStateDigest(options.expectedTargetStateDigest);
  const targetWorkspaceRef = normalizeTargetWorkspaceRef(options.targetWorkspaceRef);
  const policyProfileRef = normalizePolicyRef(
    options.policyProfileRef,
    DEFAULT_APPLY_ROLLBACK_POLICY_PROFILE_REF,
    "policyProfileRef"
  );
  const verificationContractRef = normalizePolicyRef(
    options.verificationContractRef,
    DEFAULT_APPLY_ROLLBACK_VERIFICATION_CONTRACT_REF,
    "verificationContractRef"
  );
  const blockedPathPatterns = normalizePathPatterns(
    options.blockedPathPatterns,
    DEFAULT_APPLY_ROLLBACK_BLOCKED_PATH_PATTERNS,
    "Apply/rollback blockedPathPatterns"
  );
  const escalationPathPatterns = normalizePathPatterns(
    options.escalationPathPatterns,
    DEFAULT_APPLY_ROLLBACK_ESCALATION_PATH_PATTERNS,
    "Apply/rollback escalationPathPatterns"
  );
  const requireBenchmarkValidGain = normalizeRequireBenchmarkValidGain(options.requireBenchmarkValidGain);
  const benchmarkReport =
    options.benchmarkReport === undefined ? undefined : normalizeLegacyBenchmarkReport(options.benchmarkReport);
  const previousApplyRecord =
    action === "rollback"
      ? normalizePreviousApplyRecord(options.previousApplyRecord)
      : options.previousApplyRecord === undefined
        ? undefined
        : normalizePreviousApplyRecord(options.previousApplyRecord);

  const changedPaths = prBundle.edits.map((edit) => edit.path).sort(compareStableStrings);
  const stateBefore = captureWorkspaceStateSnapshot(workspaceRoot, changedPaths);

  let preconditionsMet = true;
  let expectedPreconditionDigest: string | null = expectedTargetStateDigest;
  let preconditionFailureDetail: string | null = null;

  if (action === "apply") {
    if (expectedPreconditionDigest && stateBefore.digest !== expectedPreconditionDigest) {
      preconditionsMet = false;
      preconditionFailureDetail =
        `Apply target state digest mismatch: expected ${expectedPreconditionDigest}, observed ${stateBefore.digest}.`;
    } else {
      const operationPreconditionFailure = validateApplyOperationPreconditions(stateBefore, prBundle.edits);
      if (operationPreconditionFailure) {
        preconditionsMet = false;
        preconditionFailureDetail = operationPreconditionFailure;
      }
    }
  }

  if (action === "rollback" && previousApplyRecord) {
    expectedPreconditionDigest = previousApplyRecord.stateAfter.digest;
    if (stateBefore.digest !== expectedPreconditionDigest) {
      preconditionsMet = false;
      preconditionFailureDetail =
        `Rollback target state digest mismatch: expected ${expectedPreconditionDigest}, observed ${stateBefore.digest}.`;
    }

    if (!snapshotsCoverChangedPaths(previousApplyRecord.stateBefore, changedPaths)) {
      preconditionsMet = false;
      preconditionFailureDetail =
        "Rollback prior apply record restore snapshot does not cover all current PR bundle changed paths.";
    }

    if (!snapshotsCoverChangedPaths(previousApplyRecord.stateAfter, changedPaths)) {
      preconditionsMet = false;
      preconditionFailureDetail =
        "Rollback prior apply record post-apply snapshot does not cover all current PR bundle changed paths.";
    }

    const previousChanged = [...previousApplyRecord.changedPaths].sort(compareStableStrings);
    if (JSON.stringify(previousChanged) !== JSON.stringify(changedPaths)) {
      preconditionsMet = false;
      preconditionFailureDetail =
        "Rollback prior apply record changed paths do not match the current PR bundle diff-plan edits.";
    }
  }

  const policy = buildPolicySummary({
    action,
    allowAction,
    approvalRequired,
    approvalEvidenceRef,
    declaredCapabilities,
    changedPaths,
    blockedPathPatterns,
    escalationPathPatterns
  });

  const benchmarkEvaluation = decideFromBenchmarkGate(action, benchmarkReport, requireBenchmarkValidGain);

  let decision = createEmptyDecision();
  const decisionOverrides: Array<ApplyRollbackStageDecision | null> = [
    decideFromUpstreamArtifacts(action, prBundle),
    decideFromVerification(action, prBundle.verification),
    decideFromRollbackAvailability(action, prBundle),
    action === "rollback" ? decideFromRollbackInputs(prBundle, previousApplyRecord) : null,
    benchmarkEvaluation.decision,
    decideFromPolicy(action, policy),
    !preconditionsMet
      ? {
          decision: "stop",
          reasonCode: "conflict_detected",
          reasonDetail: preconditionFailureDetail ?? `${action} target-state preconditions failed.`
        }
      : null
  ];

  for (const candidate of decisionOverrides) {
    if (candidate) {
      decision = candidate;
      break;
    }
  }

  let stateAfter = cloneSnapshot(stateBefore);
  let executed = false;
  let restoredToPriorState = false;

  if (decision.decision === "continue" && execute) {
    try {
      if (action === "apply") {
        applyEditsToWorkspace(workspaceRoot, prBundle, action);
      } else if (action === "rollback") {
        if (!previousApplyRecord) {
          throw new ApplyRollbackError(
            "Rollback execution requires previousApplyRecord",
            "INVALID_OPTIONS"
          );
        }
        restoreWorkspaceStateSnapshot(workspaceRoot, previousApplyRecord.stateBefore);
      }
      executed = true;
      stateAfter = captureWorkspaceStateSnapshot(workspaceRoot, changedPaths);

      if (action === "rollback" && previousApplyRecord) {
        restoredToPriorState = stateAfter.digest === previousApplyRecord.stateBefore.digest;
        if (!restoredToPriorState) {
          decision = {
            decision: "stop",
            reasonCode: "conflict_detected",
            reasonDetail:
              `Rollback execution did not restore the prior state digest ${previousApplyRecord.stateBefore.digest}; observed ${stateAfter.digest}.`
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApplyRollbackError(
        `Apply/rollback execution failed: ${message}`,
        "EXECUTION_FAILED"
      );
    }
  }

  const rollbackAvailable = action === "rollback"
    ? !!previousApplyRecord?.rollbackAvailable
    : prBundle.rollback.available;
  const rollbackStrategy = action === "rollback"
    ? (previousApplyRecord?.rollbackStrategy ?? prBundle.rollback.strategy)
    : prBundle.rollback.strategy;
  const rollbackPackageDigest = action === "rollback"
    ? (previousApplyRecord?.rollbackPackageDigest ?? prBundle.rollback.packageDigest)
    : prBundle.rollback.packageDigest;

  const inputs = buildInputs({
    prBundle,
    ...(previousApplyRecord ? { previousApplyRecord } : {}),
    ...(benchmarkReport ? { benchmarkReport } : {})
  });

  const trace: ApplyRollbackArtifactV1["trace"] = {
    lineage: buildTraceLineage({
      prBundle,
      ...(previousApplyRecord ? { previousApplyRecord } : {}),
      ...(benchmarkReport ? { benchmarkReport } : {})
    }),
    boundary_mode: DEFAULT_APPLY_ROLLBACK_BOUNDARY_MODE,
    policy_profile_ref: policyProfileRef,
    verification_contract_ref: verificationContractRef,
    target_workspace_ref: targetWorkspaceRef
  };

  const payload: ApplyRollbackArtifactV1["payload"] = {
    action,
    decision: decision.decision,
    reason_code: decision.reasonCode,
    reason_detail:
      decision.decision === "continue" && !execute
        ? `${decision.reasonDetail} Execution skipped because execute=false (dry-run).`
        : decision.reasonDetail,
    policy,
    verification: prBundle.verification,
    rollback: {
      available: rollbackAvailable,
      strategy: rollbackStrategy,
      package_ref: prBundle.rollback.packageRef,
      package_digest: rollbackPackageDigest,
      package_format: prBundle.rollback.packageFormat,
      package_valid: prBundle.rollback.packageValid,
      instructions_present: prBundle.rollback.instructionsPresent,
      prior_apply_record_artifact_id: previousApplyRecord?.inputRef.artifact_id ?? null,
      previous_apply_restore_snapshot_available: previousApplyRecord
        ? snapshotsCoverChangedPaths(previousApplyRecord.stateBefore, changedPaths)
        : false,
      restored_to_prior_state: restoredToPriorState
    },
    target_state: {
      changed_paths: changedPaths,
      expected_precondition_digest: expectedPreconditionDigest,
      observed_precondition_digest: stateBefore.digest,
      preconditions_met: preconditionsMet,
      observed_result_digest: stateAfter.digest
    },
    execution: {
      mode: DEFAULT_APPLY_ROLLBACK_EXECUTION_MODE,
      execute_requested: execute,
      executed,
      state_before: stateBefore,
      state_after: stateAfter
    },
    traceability: {
      pr_bundle_artifact_id: prBundle.inputRef.artifact_id,
      patch_run_artifact_id: prBundle.patchRunRef.artifact_id,
      benchmark_gate: benchmarkEvaluation.summary
    }
  };

  const artifactDigest = buildArtifactDigest({
    inputs,
    trace,
    payload
  });

  return {
    artifact_type: APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE,
    schema_version: APPLY_ROLLBACK_RECORD_SCHEMA_VERSION,
    artifact_id: `applyrb_${artifactDigest.slice(0, 12)}`,
    run_id: resolveRunId(prBundle.runId, options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs,
    trace,
    payload
  };
}
