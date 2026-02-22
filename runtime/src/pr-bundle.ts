import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

import {
  PATCH_RUN_ARTIFACT_TYPE,
  PATCH_RUN_REASON_CODES,
  PATCH_RUN_SCHEMA_VERSION,
  type PatchRunArtifactV1,
  type PatchRunCheckStatus,
  type PatchRunDecision,
  type PatchRunFormat,
  type PatchRunVerificationResult
} from "./patch-run.ts";
import {
  SAFE_DIFF_PLAN_ARTIFACT_TYPE,
  SAFE_DIFF_PLAN_EDIT_OPERATIONS,
  SAFE_DIFF_PLAN_SCHEMA_VERSION,
  type SafeDiffPlanArtifactV1,
  type SafeDiffPlanEditOperation
} from "./safe-diff-plan.ts";
import {
  INTENT_MAPPING_ARTIFACT_TYPE,
  INTENT_MAPPING_SCHEMA_VERSION,
  type IntentMappingArtifactV1
} from "./intent-mapping.ts";
import {
  WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  type WorkspaceSnapshotArtifactV1
} from "./workspace-snapshot.ts";

export const PR_BUNDLE_ARTIFACT_TYPE = "ls.m2.pr_bundle";
export const PR_BUNDLE_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_PR_BUNDLE_TOOL_VERSION = "@l-semantica/runtime@0.1.0";
export const DEFAULT_PR_BUNDLE_BOUNDARY_MODE = "artifact_only";
export const DEFAULT_PR_BUNDLE_ROLLBACK_STRATEGY = "reverse_patch";
export const PR_BUNDLE_DECISIONS = ["continue", "stop"] as const;
export const PR_BUNDLE_REASON_CODES = [
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
  "bundle_incomplete"
] as const;
export const PR_BUNDLE_ROLLBACK_STRATEGIES = ["reverse_patch"] as const;

const PATCH_RUN_REASON_CODE_SET = new Set<string>(PATCH_RUN_REASON_CODES);
const SAFE_DIFF_PLAN_EDIT_OPERATION_SET = new Set<string>(SAFE_DIFF_PLAN_EDIT_OPERATIONS);

export type PrBundleDecision = (typeof PR_BUNDLE_DECISIONS)[number];
export type PrBundleReasonCode = (typeof PR_BUNDLE_REASON_CODES)[number];
export type PrBundleRollbackStrategy = (typeof PR_BUNDLE_ROLLBACK_STRATEGIES)[number];

export type PrBundleErrorCode = "INVALID_PATCH_RUN" | "INVALID_LINEAGE" | "INVALID_OPTIONS";

export class PrBundleError extends Error {
  readonly code: PrBundleErrorCode;

  constructor(message: string, code: PrBundleErrorCode) {
    super(message);
    this.name = "PrBundleError";
    this.code = code;
  }
}

export interface PrBundleArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface PrBundleRollbackPackage {
  format: PatchRunFormat;
  content: string;
  digest: string;
  file_count: number;
  hunk_count: number;
}

export interface PrBundleMappedTarget {
  target_id: string;
  path: string;
  symbol_path: string | null;
}

export interface PrBundleDiffPlanEditSummary {
  path: string;
  operation: SafeDiffPlanEditOperation;
  target_id?: string;
  symbol_path?: string | null;
}

export interface PrBundleReadinessRequiredSections {
  patch_digest: boolean;
  patch_payload: boolean;
  change_summary: boolean;
  change_rationale: boolean;
  risk_tradeoffs: boolean;
  verification_link: boolean;
  verification_results: boolean;
  rollback_package: boolean;
  rollback_instructions: boolean;
  lineage_trace_complete: boolean;
}

export interface PrBundleReadiness {
  decision: PrBundleDecision;
  reason_code: PrBundleReasonCode;
  reason_detail: string;
  required_sections: PrBundleReadinessRequiredSections;
  missing_sections: string[];
}

export interface PrBundleArtifactV1 {
  artifact_type: typeof PR_BUNDLE_ARTIFACT_TYPE;
  schema_version: typeof PR_BUNDLE_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: PrBundleArtifactInputRef[];
  trace: {
    lineage: string[];
    boundary_mode: typeof DEFAULT_PR_BUNDLE_BOUNDARY_MODE;
  };
  payload: {
    summary: string;
    rationale: string;
    patch: {
      format: PatchRunFormat;
      digest: string;
      content: string;
      file_count: number;
      hunk_count: number;
      patch_run_artifact_id: string;
    };
    risk_tradeoffs: string[];
    verification_evidence_ref: string | null;
    verification: {
      patch_run_artifact_id: string;
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
      strategy: PrBundleRollbackStrategy;
      supported: boolean;
      package_ref: string | null;
      package: PrBundleRollbackPackage | null;
      instructions: string[];
    };
    traceability: {
      lineage_complete: boolean;
      chain: {
        workspace_snapshot?: PrBundleArtifactInputRef;
        intent_mapping?: PrBundleArtifactInputRef;
        safe_diff_plan?: PrBundleArtifactInputRef;
        patch_run: PrBundleArtifactInputRef;
      };
      intent_summary?: string;
      mapped_targets: PrBundleMappedTarget[];
      diff_plan_edits: PrBundleDiffPlanEditSummary[];
      patch_run_outcome: {
        decision: PatchRunDecision;
        reason_code: string;
        reason_detail: string;
      };
    };
    readiness: PrBundleReadiness;
  };
}

export interface PrBundleLineageArtifacts {
  safeDiffPlan?: SafeDiffPlanArtifactV1;
  intentMapping?: IntentMappingArtifactV1;
  workspaceSnapshot?: WorkspaceSnapshotArtifactV1;
}

export interface PrBundleRollbackOverrides {
  strategy?: PrBundleRollbackStrategy;
  supported?: boolean;
  packageRef?: string | null;
  instructions?: string[];
}

export interface CreatePrBundleArtifactOptions {
  patchRun: PatchRunArtifactV1;
  lineage?: PrBundleLineageArtifacts;
  summary?: string;
  rationale?: string;
  riskTradeoffs?: string[];
  verificationEvidenceRef?: string | null;
  rollback?: PrBundleRollbackOverrides;
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface NormalizedPatchRunInput {
  inputRef: PrBundleArtifactInputRef;
  runId: string;
  safeDiffPlanRef?: PrBundleArtifactInputRef;
  patch: PrBundleArtifactV1["payload"]["patch"];
  verification: PrBundleArtifactV1["payload"]["verification"];
  decision: PatchRunDecision;
  reasonCode: string;
  reasonDetail: string;
}

interface NormalizedLineageWorkspaceSnapshot {
  inputRef: PrBundleArtifactInputRef;
  runId: string;
}

interface NormalizedLineageIntentMapping {
  inputRef: PrBundleArtifactInputRef;
  runId: string;
  workspaceSnapshotRef?: PrBundleArtifactInputRef;
  intentSummary: string;
  mappedTargets: PrBundleMappedTarget[];
}

interface NormalizedSafeDiffPlanEdit {
  path: string;
  operation: SafeDiffPlanEditOperation;
  justification: string;
  targetId?: string;
  symbolPath?: string | null;
}

interface NormalizedLineageSafeDiffPlan {
  inputRef: PrBundleArtifactInputRef;
  runId: string;
  intentMappingRef?: PrBundleArtifactInputRef;
  edits: NormalizedSafeDiffPlanEdit[];
}

interface NormalizedLineageArtifacts {
  workspaceSnapshot?: NormalizedLineageWorkspaceSnapshot;
  intentMapping?: NormalizedLineageIntentMapping;
  safeDiffPlan?: NormalizedLineageSafeDiffPlan;
  lineageComplete: boolean;
}

interface DerivedRollback {
  strategy: PrBundleRollbackStrategy;
  supported: boolean;
  packageRef: string | null;
  rollbackPackage: PrBundleRollbackPackage | null;
  instructions: string[];
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

function normalizeOptionalStringArray(
  value: unknown,
  context: string,
  errorCode: PrBundleErrorCode
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an array of strings when provided`, errorCode);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string") {
      throw new PrBundleError(`${context}[${String(index)}] must be a string`, errorCode);
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function normalizeArtifactInputRef(
  value: unknown,
  context: string,
  errorCode: PrBundleErrorCode
): PrBundleArtifactInputRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an object`, errorCode);
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
    throw new PrBundleError(
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
  errorCode: PrBundleErrorCode
): PrBundleArtifactInputRef[] {
  if (!Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an array`, errorCode);
  }

  return value.map((item, index) =>
    normalizeArtifactInputRef(item, `${context}[${String(index)}]`, errorCode)
  );
}

function refsEqual(left: PrBundleArtifactInputRef | undefined, right: PrBundleArtifactInputRef | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.artifact_id === right.artifact_id &&
    left.artifact_type === right.artifact_type &&
    left.schema_version === right.schema_version
  );
}

function findSingleInputRefByType(
  refs: PrBundleArtifactInputRef[],
  artifactType: string,
  context: string,
  errorCode: PrBundleErrorCode
): PrBundleArtifactInputRef | undefined {
  const matches = refs.filter((ref) => ref.artifact_type === artifactType);
  if (matches.length > 1) {
    throw new PrBundleError(
      `${context} must not include multiple ${artifactType} inputs`,
      errorCode
    );
  }

  return matches[0];
}

function normalizePatchRunVerificationResults(
  value: unknown,
  context: string
): PatchRunVerificationResult[] {
  if (!Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an array`, "INVALID_PATCH_RUN");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PrBundleError(
        `${context}[${String(index)}] must be an object`,
        "INVALID_PATCH_RUN"
      );
    }

    const result = item as {
      check?: unknown;
      status?: unknown;
      evidence_ref?: unknown;
      detail?: unknown;
    };

    const check = normalizeOptionalNonEmptyString(result.check);
    if (!check) {
      throw new PrBundleError(
        `${context}[${String(index)}].check must be a non-empty string`,
        "INVALID_PATCH_RUN"
      );
    }

    const status = result.status;
    if (status !== "pass" && status !== "fail" && status !== "not_run") {
      throw new PrBundleError(
        `${context}[${String(index)}].status must be pass, fail, or not_run`,
        "INVALID_PATCH_RUN"
      );
    }

    const evidenceRef = normalizeOptionalNonEmptyString(result.evidence_ref);
    const detail = normalizeOptionalNonEmptyString(result.detail);

    return {
      check,
      status: status as PatchRunCheckStatus,
      ...(evidenceRef ? { evidence_ref: evidenceRef } : {}),
      ...(detail ? { detail } : {})
    };
  });
}

function normalizePatchRunArtifact(input: unknown): NormalizedPatchRunInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PrBundleError("PR bundle requires a patch run artifact object", "INVALID_PATCH_RUN");
  }

  const artifact = input as Partial<PatchRunArtifactV1>;
  if (artifact.artifact_type !== PATCH_RUN_ARTIFACT_TYPE) {
    throw new PrBundleError(`PR bundle requires ${PATCH_RUN_ARTIFACT_TYPE} input`, "INVALID_PATCH_RUN");
  }

  if (artifact.schema_version !== PATCH_RUN_SCHEMA_VERSION) {
    throw new PrBundleError(
      `PR bundle requires ${PATCH_RUN_ARTIFACT_TYPE}@${PATCH_RUN_SCHEMA_VERSION}`,
      "INVALID_PATCH_RUN"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new PrBundleError(
      "PR bundle patch run is missing required envelope fields",
      "INVALID_PATCH_RUN"
    );
  }

  const inputRefs = normalizeArtifactInputRefs(artifact.inputs, "PR bundle patch run inputs", "INVALID_PATCH_RUN");
  const safeDiffPlanRef = findSingleInputRefByType(
    inputRefs,
    SAFE_DIFF_PLAN_ARTIFACT_TYPE,
    "PR bundle patch run inputs",
    "INVALID_PATCH_RUN"
  );
  if (!safeDiffPlanRef) {
    throw new PrBundleError(
      `PR bundle patch run inputs must include a ${SAFE_DIFF_PLAN_ARTIFACT_TYPE} reference`,
      "INVALID_PATCH_RUN"
    );
  }

  const payload = artifact.payload as
    | {
        patch?: {
          format?: unknown;
          content?: unknown;
          file_count?: unknown;
          hunk_count?: unknown;
        };
        patch_digest?: unknown;
        verification?: {
          required_checks?: unknown;
          results?: unknown;
          checks_complete?: unknown;
          evidence_complete?: unknown;
          all_required_passed?: unknown;
          missing_required_checks?: unknown;
          incomplete_checks?: unknown;
          failing_checks?: unknown;
        };
        decision?: unknown;
        reason_code?: unknown;
        reason_detail?: unknown;
      }
    | undefined;

  const patchFormat = payload?.patch?.format;
  if (patchFormat !== "unified_diff") {
    throw new PrBundleError(
      "PR bundle patch run payload.patch.format must be unified_diff",
      "INVALID_PATCH_RUN"
    );
  }

  if (typeof payload?.patch?.content !== "string") {
    throw new PrBundleError(
      "PR bundle patch run payload.patch.content must be a string",
      "INVALID_PATCH_RUN"
    );
  }

  const patchDigest = normalizeOptionalNonEmptyString(payload?.patch_digest);
  if (!patchDigest) {
    throw new PrBundleError(
      "PR bundle patch run payload.patch_digest is required",
      "INVALID_PATCH_RUN"
    );
  }

  const computedPatchDigest = `sha256:${createHash("sha256").update(payload.patch.content).digest("hex")}`;
  if (computedPatchDigest !== patchDigest) {
    throw new PrBundleError(
      "PR bundle patch run payload.patch_digest does not match payload.patch.content",
      "INVALID_PATCH_RUN"
    );
  }

  const fileCount = payload.patch.file_count;
  const hunkCount = payload.patch.hunk_count;
  if (
    typeof fileCount !== "number" ||
    !Number.isInteger(fileCount) ||
    fileCount < 0 ||
    typeof hunkCount !== "number" ||
    !Number.isInteger(hunkCount) ||
    hunkCount < 0
  ) {
    throw new PrBundleError(
      "PR bundle patch run payload.patch.file_count and hunk_count must be non-negative integers",
      "INVALID_PATCH_RUN"
    );
  }

  const verification = payload?.verification;
  if (typeof verification !== "object" || verification === null || Array.isArray(verification)) {
    throw new PrBundleError(
      "PR bundle patch run payload.verification is required",
      "INVALID_PATCH_RUN"
    );
  }

  const requiredChecks = normalizeOptionalStringArray(
    verification.required_checks,
    "PR bundle patch run payload.verification.required_checks",
    "INVALID_PATCH_RUN"
  );
  if (!requiredChecks) {
    throw new PrBundleError(
      "PR bundle patch run payload.verification.required_checks must be an array",
      "INVALID_PATCH_RUN"
    );
  }

  const results = normalizePatchRunVerificationResults(
    verification.results,
    "PR bundle patch run payload.verification.results"
  );

  if (typeof verification.checks_complete !== "boolean") {
    throw new PrBundleError(
      "PR bundle patch run payload.verification.checks_complete must be a boolean",
      "INVALID_PATCH_RUN"
    );
  }
  if (typeof verification.evidence_complete !== "boolean") {
    throw new PrBundleError(
      "PR bundle patch run payload.verification.evidence_complete must be a boolean",
      "INVALID_PATCH_RUN"
    );
  }
  if (typeof verification.all_required_passed !== "boolean") {
    throw new PrBundleError(
      "PR bundle patch run payload.verification.all_required_passed must be a boolean",
      "INVALID_PATCH_RUN"
    );
  }

  const missingRequiredChecks =
    normalizeOptionalStringArray(
      verification.missing_required_checks,
      "PR bundle patch run payload.verification.missing_required_checks",
      "INVALID_PATCH_RUN"
    ) ?? [];
  const incompleteChecks =
    normalizeOptionalStringArray(
      verification.incomplete_checks,
      "PR bundle patch run payload.verification.incomplete_checks",
      "INVALID_PATCH_RUN"
    ) ?? [];
  const failingChecks =
    normalizeOptionalStringArray(
      verification.failing_checks,
      "PR bundle patch run payload.verification.failing_checks",
      "INVALID_PATCH_RUN"
    ) ?? [];

  const decision = payload?.decision;
  if (decision !== "continue" && decision !== "escalate" && decision !== "stop") {
    throw new PrBundleError(
      "PR bundle patch run payload.decision must be continue, escalate, or stop",
      "INVALID_PATCH_RUN"
    );
  }

  const reasonCode = normalizeOptionalNonEmptyString(payload?.reason_code);
  const reasonDetail = normalizeOptionalNonEmptyString(payload?.reason_detail);
  if (!reasonCode || !reasonDetail) {
    throw new PrBundleError(
      "PR bundle patch run payload.reason_code and payload.reason_detail are required",
      "INVALID_PATCH_RUN"
    );
  }

  if (!PATCH_RUN_REASON_CODE_SET.has(reasonCode)) {
    throw new PrBundleError(
      "PR bundle patch run payload.reason_code is unsupported for the pinned schema version",
      "INVALID_PATCH_RUN"
    );
  }

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: artifact.artifact_type,
      schema_version: artifact.schema_version
    },
    runId,
    safeDiffPlanRef,
    patch: {
      format: patchFormat,
      digest: patchDigest,
      content: payload.patch.content,
      file_count: fileCount,
      hunk_count: hunkCount,
      patch_run_artifact_id: artifactId
    },
    verification: {
      patch_run_artifact_id: artifactId,
      required_checks: requiredChecks,
      results,
      checks_complete: verification.checks_complete,
      evidence_complete: verification.evidence_complete,
      all_required_passed: verification.all_required_passed,
      missing_required_checks: missingRequiredChecks,
      incomplete_checks: incompleteChecks,
      failing_checks: failingChecks
    },
    decision,
    reasonCode,
    reasonDetail
  };
}

function normalizeWorkspaceSnapshotLineage(input: unknown): NormalizedLineageWorkspaceSnapshot {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PrBundleError(
      "PR bundle lineage.workspaceSnapshot must be an artifact object",
      "INVALID_LINEAGE"
    );
  }

  const artifact = input as Partial<WorkspaceSnapshotArtifactV1>;
  if (artifact.artifact_type !== WORKSPACE_SNAPSHOT_ARTIFACT_TYPE) {
    throw new PrBundleError(
      `PR bundle lineage.workspaceSnapshot must be ${WORKSPACE_SNAPSHOT_ARTIFACT_TYPE}`,
      "INVALID_LINEAGE"
    );
  }

  if (artifact.schema_version !== WORKSPACE_SNAPSHOT_SCHEMA_VERSION) {
    throw new PrBundleError(
      `PR bundle lineage.workspaceSnapshot must be ${WORKSPACE_SNAPSHOT_ARTIFACT_TYPE}@${WORKSPACE_SNAPSHOT_SCHEMA_VERSION}`,
      "INVALID_LINEAGE"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new PrBundleError(
      "PR bundle lineage.workspaceSnapshot is missing required envelope fields",
      "INVALID_LINEAGE"
    );
  }

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: artifact.artifact_type,
      schema_version: artifact.schema_version
    },
    runId
  };
}

function normalizeIntentMappingTarget(value: unknown, context: string): PrBundleMappedTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an object`, "INVALID_LINEAGE");
  }

  const target = value as {
    target_id?: unknown;
    path?: unknown;
    symbol_path?: unknown;
  };
  const targetId = normalizeOptionalNonEmptyString(target.target_id);
  const path = normalizeOptionalNonEmptyString(target.path);
  if (!targetId || !path) {
    throw new PrBundleError(
      `${context} must include target_id and path`,
      "INVALID_LINEAGE"
    );
  }

  let symbolPath: string | null = null;
  if (target.symbol_path === null || target.symbol_path === undefined) {
    symbolPath = target.symbol_path === null ? null : null;
  } else {
    const normalizedSymbolPath = normalizeOptionalNonEmptyString(target.symbol_path);
    if (!normalizedSymbolPath) {
      throw new PrBundleError(
        `${context}.symbol_path must be null or a non-empty string`,
        "INVALID_LINEAGE"
      );
    }
    symbolPath = normalizedSymbolPath;
  }

  return {
    target_id: targetId,
    path: path.replace(/\\/g, "/"),
    symbol_path: symbolPath
  };
}

function normalizeIntentMappingLineage(input: unknown): NormalizedLineageIntentMapping {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PrBundleError(
      "PR bundle lineage.intentMapping must be an artifact object",
      "INVALID_LINEAGE"
    );
  }

  const artifact = input as Partial<IntentMappingArtifactV1>;
  if (artifact.artifact_type !== INTENT_MAPPING_ARTIFACT_TYPE) {
    throw new PrBundleError(
      `PR bundle lineage.intentMapping must be ${INTENT_MAPPING_ARTIFACT_TYPE}`,
      "INVALID_LINEAGE"
    );
  }

  if (artifact.schema_version !== INTENT_MAPPING_SCHEMA_VERSION) {
    throw new PrBundleError(
      `PR bundle lineage.intentMapping must be ${INTENT_MAPPING_ARTIFACT_TYPE}@${INTENT_MAPPING_SCHEMA_VERSION}`,
      "INVALID_LINEAGE"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new PrBundleError(
      "PR bundle lineage.intentMapping is missing required envelope fields",
      "INVALID_LINEAGE"
    );
  }

  const inputRefs = normalizeArtifactInputRefs(
    artifact.inputs,
    "PR bundle lineage.intentMapping inputs",
    "INVALID_LINEAGE"
  );
  const workspaceSnapshotRef = findSingleInputRefByType(
    inputRefs,
    WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
    "PR bundle lineage.intentMapping inputs",
    "INVALID_LINEAGE"
  );

  const payload = artifact.payload as
    | {
        intent?: { summary?: unknown };
        candidates?: unknown;
      }
    | undefined;
  const intentSummary = normalizeOptionalNonEmptyString(payload?.intent?.summary);
  if (!intentSummary) {
    throw new PrBundleError(
      "PR bundle lineage.intentMapping payload.intent.summary is required",
      "INVALID_LINEAGE"
    );
  }

  if (!Array.isArray(payload?.candidates)) {
    throw new PrBundleError(
      "PR bundle lineage.intentMapping payload.candidates must be an array",
      "INVALID_LINEAGE"
    );
  }

  const mappedTargets = payload.candidates.map((candidate, index) =>
    normalizeIntentMappingTarget(candidate, `PR bundle lineage.intentMapping payload.candidates[${String(index)}]`)
  );

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: artifact.artifact_type,
      schema_version: artifact.schema_version
    },
    runId,
    workspaceSnapshotRef,
    intentSummary,
    mappedTargets
  };
}

function normalizeSafeDiffPlanEditPath(value: unknown, context: string): string {
  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new PrBundleError(`${context}.path must be a non-empty string`, "INVALID_LINEAGE");
  }

  const withForwardSlashes = normalized.replace(/\\/g, "/");
  const pathValue = posix.normalize(withForwardSlashes).replace(/^\.\/+/, "");
  if (
    pathValue.length === 0 ||
    pathValue === "." ||
    pathValue.startsWith("/") ||
    /^[A-Za-z]:\//.test(pathValue) ||
    pathValue === ".." ||
    pathValue.startsWith("../")
  ) {
    throw new PrBundleError(`${context}.path must be workspace-relative`, "INVALID_LINEAGE");
  }

  return pathValue;
}

function normalizeSafeDiffPlanEditSummary(value: unknown, context: string): NormalizedSafeDiffPlanEdit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrBundleError(`${context} must be an object`, "INVALID_LINEAGE");
  }

  const edit = value as {
    path?: unknown;
    operation?: unknown;
    justification?: unknown;
    target_id?: unknown;
    symbol_path?: unknown;
  };

  const path = normalizeSafeDiffPlanEditPath(edit.path, context);
  const operation = edit.operation;
  if (!SAFE_DIFF_PLAN_EDIT_OPERATION_SET.has(String(operation ?? ""))) {
    throw new PrBundleError(
      `${context}.operation is unsupported for the pinned schema version`,
      "INVALID_LINEAGE"
    );
  }

  const justification = normalizeOptionalNonEmptyString(edit.justification);
  if (!justification) {
    throw new PrBundleError(`${context}.justification is required`, "INVALID_LINEAGE");
  }

  const targetId = normalizeOptionalNonEmptyString(edit.target_id);
  let symbolPath: string | null | undefined;
  if (edit.symbol_path === null) {
    symbolPath = null;
  } else if (edit.symbol_path !== undefined) {
    const normalizedSymbolPath = normalizeOptionalNonEmptyString(edit.symbol_path);
    if (!normalizedSymbolPath) {
      throw new PrBundleError(
        `${context}.symbol_path must be null or a non-empty string`,
        "INVALID_LINEAGE"
      );
    }
    symbolPath = normalizedSymbolPath;
  }

  return {
    path,
    operation: operation as SafeDiffPlanEditOperation,
    justification,
    ...(targetId ? { targetId } : {}),
    ...(edit.symbol_path !== undefined ? { symbolPath: symbolPath ?? null } : {})
  };
}

function normalizeSafeDiffPlanLineage(input: unknown): NormalizedLineageSafeDiffPlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PrBundleError(
      "PR bundle lineage.safeDiffPlan must be an artifact object",
      "INVALID_LINEAGE"
    );
  }

  const artifact = input as Partial<SafeDiffPlanArtifactV1>;
  if (artifact.artifact_type !== SAFE_DIFF_PLAN_ARTIFACT_TYPE) {
    throw new PrBundleError(
      `PR bundle lineage.safeDiffPlan must be ${SAFE_DIFF_PLAN_ARTIFACT_TYPE}`,
      "INVALID_LINEAGE"
    );
  }

  if (artifact.schema_version !== SAFE_DIFF_PLAN_SCHEMA_VERSION) {
    throw new PrBundleError(
      `PR bundle lineage.safeDiffPlan must be ${SAFE_DIFF_PLAN_ARTIFACT_TYPE}@${SAFE_DIFF_PLAN_SCHEMA_VERSION}`,
      "INVALID_LINEAGE"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(artifact.artifact_id);
  const runId = normalizeOptionalNonEmptyString(artifact.run_id);
  if (!artifactId || !runId) {
    throw new PrBundleError(
      "PR bundle lineage.safeDiffPlan is missing required envelope fields",
      "INVALID_LINEAGE"
    );
  }

  const inputRefs = normalizeArtifactInputRefs(
    artifact.inputs,
    "PR bundle lineage.safeDiffPlan inputs",
    "INVALID_LINEAGE"
  );
  const intentMappingRef = findSingleInputRefByType(
    inputRefs,
    INTENT_MAPPING_ARTIFACT_TYPE,
    "PR bundle lineage.safeDiffPlan inputs",
    "INVALID_LINEAGE"
  );

  const payload = artifact.payload as { edits?: unknown } | undefined;
  if (!Array.isArray(payload?.edits)) {
    throw new PrBundleError(
      "PR bundle lineage.safeDiffPlan payload.edits must be an array",
      "INVALID_LINEAGE"
    );
  }

  const edits = payload.edits.map((edit, index) =>
    normalizeSafeDiffPlanEditSummary(edit, `PR bundle lineage.safeDiffPlan payload.edits[${String(index)}]`)
  );

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: artifact.artifact_type,
      schema_version: artifact.schema_version
    },
    runId,
    intentMappingRef,
    edits
  };
}

function normalizeLineageArtifacts(
  value: unknown,
  patchRun: NormalizedPatchRunInput
): NormalizedLineageArtifacts {
  if (value === undefined) {
    return {
      lineageComplete: false
    };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrBundleError("PR bundle lineage must be an object when provided", "INVALID_OPTIONS");
  }

  const lineage = value as PrBundleLineageArtifacts;
  const workspaceSnapshot =
    lineage.workspaceSnapshot !== undefined
      ? normalizeWorkspaceSnapshotLineage(lineage.workspaceSnapshot)
      : undefined;
  const intentMapping =
    lineage.intentMapping !== undefined ? normalizeIntentMappingLineage(lineage.intentMapping) : undefined;
  const safeDiffPlan =
    lineage.safeDiffPlan !== undefined ? normalizeSafeDiffPlanLineage(lineage.safeDiffPlan) : undefined;

  const lineageRunIds = [patchRun.runId, safeDiffPlan?.runId, intentMapping?.runId, workspaceSnapshot?.runId].filter(
    (item): item is string => typeof item === "string"
  );
  const uniqueRunIds = Array.from(new Set(lineageRunIds));
  if (uniqueRunIds.length > 1) {
    throw new PrBundleError(
      `PR bundle lineage artifacts must share a run_id with patch run; observed: ${uniqueRunIds.join(", ")}`,
      "INVALID_LINEAGE"
    );
  }

  if (safeDiffPlan && patchRun.safeDiffPlanRef && !refsEqual(patchRun.safeDiffPlanRef, safeDiffPlan.inputRef)) {
    throw new PrBundleError(
      "PR bundle lineage.safeDiffPlan does not match patch run inputs reference",
      "INVALID_LINEAGE"
    );
  }

  if (intentMapping && safeDiffPlan?.intentMappingRef && !refsEqual(safeDiffPlan.intentMappingRef, intentMapping.inputRef)) {
    throw new PrBundleError(
      "PR bundle lineage.intentMapping does not match safe diff plan inputs reference",
      "INVALID_LINEAGE"
    );
  }

  if (
    workspaceSnapshot &&
    intentMapping?.workspaceSnapshotRef &&
    !refsEqual(intentMapping.workspaceSnapshotRef, workspaceSnapshot.inputRef)
  ) {
    throw new PrBundleError(
      "PR bundle lineage.workspaceSnapshot does not match intent mapping inputs reference",
      "INVALID_LINEAGE"
    );
  }

  const lineageComplete =
    !!workspaceSnapshot &&
    !!intentMapping &&
    !!safeDiffPlan &&
    !!patchRun.safeDiffPlanRef &&
    !!safeDiffPlan.intentMappingRef &&
    !!intentMapping.workspaceSnapshotRef &&
    refsEqual(patchRun.safeDiffPlanRef, safeDiffPlan.inputRef) &&
    refsEqual(safeDiffPlan.intentMappingRef, intentMapping.inputRef) &&
    refsEqual(intentMapping.workspaceSnapshotRef, workspaceSnapshot.inputRef);

  return {
    workspaceSnapshot,
    intentMapping,
    safeDiffPlan,
    lineageComplete
  };
}

function invertEditOperation(operation: SafeDiffPlanEditOperation): SafeDiffPlanEditOperation {
  if (operation === "create") {
    return "delete";
  }

  if (operation === "delete") {
    return "create";
  }

  return "modify";
}

function normalizeForSingleLine(value: string, maxLength = 180): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function buildRollbackMetadataLabel(edit: NormalizedSafeDiffPlanEdit): string {
  const symbolLabel =
    edit.symbolPath === undefined
      ? "symbol:unspecified"
      : edit.symbolPath === null
        ? "symbol:file"
        : `symbol:${normalizeForSingleLine(edit.symbolPath, 96)}`;
  const targetLabel = edit.targetId ? `target:${normalizeForSingleLine(edit.targetId, 96)}` : "target:none";
  const justificationLabel = `why:${normalizeForSingleLine(edit.justification, 120)}`;

  return [symbolLabel, targetLabel, justificationLabel].join(" | ");
}

function buildRollbackPatchChunkForEdit(edit: NormalizedSafeDiffPlanEdit): string {
  const rollbackOperation = invertEditOperation(edit.operation);
  const metadata = buildRollbackMetadataLabel(edit);

  if (rollbackOperation === "create") {
    return [
      `diff --git a/${edit.path} b/${edit.path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${edit.path}`,
      "@@ -0,0 +1 @@",
      `+__ls_m2_pr_bundle_rollback_create__ ${metadata}`
    ].join("\n");
  }

  if (rollbackOperation === "delete") {
    return [
      `diff --git a/${edit.path} b/${edit.path}`,
      "deleted file mode 100644",
      `--- a/${edit.path}`,
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      `-__ls_m2_pr_bundle_rollback_delete__ ${metadata}`
    ].join("\n");
  }

  return [
    `diff --git a/${edit.path} b/${edit.path}`,
    `--- a/${edit.path}`,
    `+++ b/${edit.path}`,
    "@@ -1 +1 @@",
    "-__ls_m2_pr_bundle_rollback_before__",
    `+__ls_m2_pr_bundle_rollback_after__ ${metadata}`
  ].join("\n");
}

function buildRollbackPatchContent(edits: NormalizedSafeDiffPlanEdit[]): string {
  if (edits.length === 0) {
    return "";
  }

  const reversed = [...edits].reverse();
  return `${reversed.map((edit) => buildRollbackPatchChunkForEdit(edit)).join("\n\n")}\n`;
}

function buildPatchDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function resolveRollbackStrategy(value: unknown): PrBundleRollbackStrategy {
  if (value === undefined) {
    return DEFAULT_PR_BUNDLE_ROLLBACK_STRATEGY;
  }

  if (value !== "reverse_patch") {
    throw new PrBundleError(
      "PR bundle rollback.strategy must be reverse_patch when provided",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function buildDefaultRollbackInstructions(params: {
  packageRef: string;
  patchRunArtifactId: string;
  safeDiffPlanArtifactId?: string;
}): string[] {
  const baseInstructions = [
    `Apply rollback package ${params.packageRef} as a unified diff against the same workspace baseline expected by patch run ${params.patchRunArtifactId}.`,
    "Verify the target workspace state matches the expected pre-apply conditions before executing rollback.",
    "Re-run required checks and record evidence linkage in the future apply/rollback artifact (#56)."
  ];

  if (params.safeDiffPlanArtifactId) {
    baseInstructions.splice(
      1,
      0,
      `Use safe diff plan ${params.safeDiffPlanArtifactId} as the authoritative path/order reference when reviewing rollback hunks.`
    );
  }

  return baseInstructions;
}

function deriveRollback(params: {
  safeDiffPlan?: NormalizedLineageSafeDiffPlan;
  patchRunArtifactId: string;
  overrides?: PrBundleRollbackOverrides;
}): DerivedRollback {
  const strategy = resolveRollbackStrategy(params.overrides?.strategy);
  const forcedSupported = params.overrides?.supported;
  const normalizedInstructionsOverride = normalizeOptionalStringArray(
    params.overrides?.instructions,
    "PR bundle rollback.instructions",
    "INVALID_OPTIONS"
  );
  const packageRefOverride = normalizeOptionalStringOrNull(params.overrides?.packageRef);

  const canBuildRollbackPackage = !!params.safeDiffPlan && params.safeDiffPlan.edits.length > 0 && strategy === "reverse_patch";
  const supported = forcedSupported ?? canBuildRollbackPackage;

  if (!supported || !canBuildRollbackPackage) {
    return {
      strategy,
      supported: false,
      packageRef: packageRefOverride ?? null,
      rollbackPackage: null,
      instructions: normalizedInstructionsOverride ?? []
    };
  }

  const safeDiffPlan = params.safeDiffPlan;
  if (!safeDiffPlan) {
    return {
      strategy,
      supported: false,
      packageRef: packageRefOverride ?? null,
      rollbackPackage: null,
      instructions: normalizedInstructionsOverride ?? []
    };
  }

  const content = buildRollbackPatchContent(safeDiffPlan.edits);
  const digest = buildPatchDigest(content);
  const fileCount = new Set(safeDiffPlan.edits.map((edit) => edit.path)).size;
  const hunkCount = safeDiffPlan.edits.length;
  const packageRef = packageRefOverride ?? `rollback_${digest.slice("sha256:".length, "sha256:".length + 12)}`;

  return {
    strategy,
    supported: true,
    packageRef,
    rollbackPackage: {
      format: "unified_diff",
      content,
      digest,
      file_count: fileCount,
      hunk_count: hunkCount
    },
    instructions:
      normalizedInstructionsOverride ??
      buildDefaultRollbackInstructions({
        packageRef,
        patchRunArtifactId: params.patchRunArtifactId,
        safeDiffPlanArtifactId: safeDiffPlan.inputRef.artifact_id
      })
  };
}

function resolveSummary(value: unknown, lineage: NormalizedLineageArtifacts, patchRun: NormalizedPatchRunInput): string {
  const explicit = normalizeOptionalNonEmptyString(value);
  if (explicit) {
    return explicit;
  }

  if (lineage.intentMapping?.intentSummary) {
    return normalizeForSingleLine(lineage.intentMapping.intentSummary, 160);
  }

  if (patchRun.decision === "escalate") {
    return `PR-equivalent bundle for patch run ${patchRun.inputRef.artifact_id} (human review required)`;
  }

  return `PR-equivalent bundle for patch run ${patchRun.inputRef.artifact_id}`;
}

function resolveRationale(value: unknown, lineage: NormalizedLineageArtifacts, patchRun: NormalizedPatchRunInput): string {
  const explicit = normalizeOptionalNonEmptyString(value);
  if (explicit) {
    return explicit;
  }

  const edits = lineage.safeDiffPlan?.edits ?? [];
  if (edits.length > 0) {
    const pathList = edits.slice(0, 3).map((edit) => edit.path).join(", ");
    const extraCount = Math.max(0, edits.length - 3);
    const suffix = extraCount > 0 ? ` (+${String(extraCount)} more)` : "";
    return `Packages patch run ${patchRun.inputRef.artifact_id} with ${String(edits.length)} planned edit(s) from safe diff plan ${lineage.safeDiffPlan?.inputRef.artifact_id}: ${pathList}${suffix}.`;
  }

  return `Packages patch run ${patchRun.inputRef.artifact_id} into a human-inspectable PR-equivalent artifact bundle for review and downstream apply/rollback gating.`;
}

function resolveRiskTradeoffs(
  value: unknown,
  patchRun: NormalizedPatchRunInput,
  lineage: NormalizedLineageArtifacts
): string[] {
  const explicit = normalizeOptionalStringArray(value, "PR bundle riskTradeoffs", "INVALID_OPTIONS");
  if (explicit) {
    return explicit;
  }

  const risks: string[] = [
    "Patch content remains a deterministic placeholder unified diff intended for review/package handoff, not full file-content patch synthesis."
  ];

  if (patchRun.decision === "escalate" && patchRun.reasonCode === "policy_blocked") {
    risks.push("Patch run marked policy-sensitive paths; human review is required before any apply decision.");
  } else if (patchRun.decision === "stop") {
    risks.push(`Patch run blocked continuation (${patchRun.reasonCode}); this bundle is inspection-only and not apply-ready.`);
  }

  if (!lineage.lineageComplete) {
    risks.push("Lineage trace is incomplete; bundle should not be used as an autonomous apply prerequisite.");
  }

  return risks;
}

function resolveVerificationEvidenceRef(value: unknown, patchRun: NormalizedPatchRunInput): string | null {
  if (value === null) {
    return null;
  }

  const explicit = normalizeOptionalNonEmptyString(value);
  if (explicit) {
    return explicit;
  }

  if (value !== undefined) {
    return null;
  }

  return patchRun.inputRef.artifact_id;
}

function buildTraceabilityChain(
  patchRun: NormalizedPatchRunInput,
  lineage: NormalizedLineageArtifacts
): PrBundleArtifactV1["payload"]["traceability"]["chain"] {
  return {
    ...(lineage.workspaceSnapshot ? { workspace_snapshot: lineage.workspaceSnapshot.inputRef } : {}),
    ...(lineage.intentMapping ? { intent_mapping: lineage.intentMapping.inputRef } : {}),
    ...(lineage.safeDiffPlan ? { safe_diff_plan: lineage.safeDiffPlan.inputRef } : {}),
    patch_run: patchRun.inputRef
  };
}

function buildArtifactInputs(
  patchRun: NormalizedPatchRunInput,
  lineage: NormalizedLineageArtifacts
): PrBundleArtifactInputRef[] {
  const refs: PrBundleArtifactInputRef[] = [];
  const seen = new Set<string>();

  const pushRef = (ref: PrBundleArtifactInputRef | undefined) => {
    if (!ref) {
      return;
    }

    const key = `${ref.artifact_type}|${ref.schema_version}|${ref.artifact_id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(ref);
  };

  pushRef(lineage.workspaceSnapshot?.inputRef);
  pushRef(lineage.intentMapping?.inputRef);
  pushRef(lineage.safeDiffPlan?.inputRef);
  pushRef(patchRun.inputRef);

  return refs;
}

function buildTraceLineageIds(
  patchRun: NormalizedPatchRunInput,
  lineage: NormalizedLineageArtifacts
): string[] {
  const ordered = [
    lineage.workspaceSnapshot?.inputRef.artifact_id,
    lineage.intentMapping?.inputRef.artifact_id,
    lineage.safeDiffPlan?.inputRef.artifact_id,
    patchRun.inputRef.artifact_id
  ].filter((item): item is string => typeof item === "string" && item.length > 0);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const artifactId of ordered) {
    if (seen.has(artifactId)) {
      continue;
    }
    seen.add(artifactId);
    deduped.push(artifactId);
  }

  return deduped;
}

function buildDiffPlanEditSummaries(lineage: NormalizedLineageArtifacts): PrBundleDiffPlanEditSummary[] {
  if (!lineage.safeDiffPlan) {
    return [];
  }

  return lineage.safeDiffPlan.edits.map((edit) => ({
    path: edit.path,
    operation: edit.operation,
    ...(edit.targetId ? { target_id: edit.targetId } : {}),
    ...(edit.symbolPath !== undefined ? { symbol_path: edit.symbolPath ?? null } : {})
  }));
}

function collectMissingReadinessSections(
  requiredSections: PrBundleReadinessRequiredSections
): string[] {
  const orderedKeys: Array<keyof PrBundleReadinessRequiredSections> = [
    "patch_digest",
    "patch_payload",
    "change_summary",
    "change_rationale",
    "risk_tradeoffs",
    "verification_link",
    "verification_results",
    "rollback_package",
    "rollback_instructions",
    "lineage_trace_complete"
  ];

  return orderedKeys.filter((key) => !requiredSections[key]);
}

function resolveReadiness(params: {
  patchRun: NormalizedPatchRunInput;
  summary: string;
  rationale: string;
  riskTradeoffs: string[];
  verificationEvidenceRef: string | null;
  rollback: DerivedRollback;
  lineageComplete: boolean;
}): PrBundleReadiness {
  const verificationResultsReady =
    params.patchRun.verification.checks_complete &&
    params.patchRun.verification.evidence_complete &&
    params.patchRun.verification.all_required_passed;

  const rollbackPackageReady =
    params.rollback.supported &&
    !!params.rollback.packageRef &&
    !!params.rollback.rollbackPackage &&
    params.rollback.rollbackPackage.content.length > 0 &&
    params.rollback.rollbackPackage.digest.length > 0;

  const requiredSections: PrBundleReadinessRequiredSections = {
    patch_digest: params.patchRun.patch.digest.length > 0,
    patch_payload: params.patchRun.patch.content.length > 0,
    change_summary: params.summary.trim().length > 0,
    change_rationale: params.rationale.trim().length > 0,
    risk_tradeoffs: params.riskTradeoffs.length > 0,
    verification_link: typeof params.verificationEvidenceRef === "string" && params.verificationEvidenceRef.length > 0,
    verification_results: verificationResultsReady,
    rollback_package: rollbackPackageReady,
    rollback_instructions: params.rollback.instructions.length > 0,
    lineage_trace_complete: params.lineageComplete
  };

  const missingSections = collectMissingReadinessSections(requiredSections);
  if (missingSections.length === 0) {
    return {
      decision: "continue",
      reason_code: "ok",
      reason_detail:
        "PR-equivalent bundle includes patch payload, rationale, risk tradeoffs, verification linkage/results, rollback package/instructions, and complete lineage trace.",
      required_sections: requiredSections,
      missing_sections: []
    };
  }

  let reasonCode: PrBundleReasonCode = "bundle_incomplete";
  if (!params.patchRun.verification.checks_complete || !params.patchRun.verification.evidence_complete) {
    reasonCode = "verification_incomplete";
  } else if (!params.patchRun.verification.all_required_passed) {
    reasonCode = "verification_failed";
  } else if (params.patchRun.decision === "stop" && PATCH_RUN_REASON_CODE_SET.has(params.patchRun.reasonCode)) {
    reasonCode = params.patchRun.reasonCode as PrBundleReasonCode;
  } else if (!rollbackPackageReady || !params.rollback.supported) {
    reasonCode = "rollback_unavailable";
  }

  const upstreamDetail =
    params.patchRun.decision === "continue"
      ? ""
      : ` Upstream patch run outcome=${params.patchRun.decision}/${params.patchRun.reasonCode}.`;

  return {
    decision: "stop",
    reason_code: reasonCode,
    reason_detail: `PR-equivalent bundle is not ready; missing required sections: ${missingSections.join(", ")}.${upstreamDetail}`,
    required_sections: requiredSections,
    missing_sections: missingSections
  };
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

function resolveToolVersion(toolVersion: unknown): string {
  return normalizeOptionalNonEmptyString(toolVersion) ?? DEFAULT_PR_BUNDLE_TOOL_VERSION;
}

function buildArtifactDigest(input: {
  inputs: PrBundleArtifactInputRef[];
  trace: PrBundleArtifactV1["trace"];
  payload: PrBundleArtifactV1["payload"];
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

export function createPrBundleArtifact(options: CreatePrBundleArtifactOptions): PrBundleArtifactV1 {
  if (typeof options !== "object" || options === null) {
    throw new PrBundleError("PR bundle options must be an object", "INVALID_OPTIONS");
  }

  const patchRun = normalizePatchRunArtifact(options.patchRun);
  const lineage = normalizeLineageArtifacts(options.lineage, patchRun);
  const summary = resolveSummary(options.summary, lineage, patchRun);
  const rationale = resolveRationale(options.rationale, lineage, patchRun);
  const riskTradeoffs = resolveRiskTradeoffs(options.riskTradeoffs, patchRun, lineage);
  const verificationEvidenceRef = resolveVerificationEvidenceRef(options.verificationEvidenceRef, patchRun);
  const rollback = deriveRollback({
    safeDiffPlan: lineage.safeDiffPlan,
    patchRunArtifactId: patchRun.inputRef.artifact_id,
    overrides: options.rollback
  });

  const traceability: PrBundleArtifactV1["payload"]["traceability"] = {
    lineage_complete: lineage.lineageComplete,
    chain: buildTraceabilityChain(patchRun, lineage),
    ...(lineage.intentMapping ? { intent_summary: lineage.intentMapping.intentSummary } : {}),
    mapped_targets: lineage.intentMapping?.mappedTargets ?? [],
    diff_plan_edits: buildDiffPlanEditSummaries(lineage),
    patch_run_outcome: {
      decision: patchRun.decision,
      reason_code: patchRun.reasonCode,
      reason_detail: patchRun.reasonDetail
    }
  };

  const readiness = resolveReadiness({
    patchRun,
    summary,
    rationale,
    riskTradeoffs,
    verificationEvidenceRef,
    rollback,
    lineageComplete: lineage.lineageComplete
  });

  const inputs = buildArtifactInputs(patchRun, lineage);
  const trace: PrBundleArtifactV1["trace"] = {
    lineage: buildTraceLineageIds(patchRun, lineage),
    boundary_mode: DEFAULT_PR_BUNDLE_BOUNDARY_MODE
  };

  const payload: PrBundleArtifactV1["payload"] = {
    summary,
    rationale,
    patch: patchRun.patch,
    risk_tradeoffs: riskTradeoffs,
    verification_evidence_ref: verificationEvidenceRef,
    verification: patchRun.verification,
    rollback: {
      strategy: rollback.strategy,
      supported: rollback.supported,
      package_ref: rollback.packageRef,
      package: rollback.rollbackPackage,
      instructions: rollback.instructions
    },
    traceability,
    readiness
  };

  const artifactDigest = buildArtifactDigest({
    inputs,
    trace,
    payload
  });

  return {
    artifact_type: PR_BUNDLE_ARTIFACT_TYPE,
    schema_version: PR_BUNDLE_SCHEMA_VERSION,
    artifact_id: `prb_${artifactDigest.slice(0, 12)}`,
    run_id: resolveRunId(patchRun.runId, options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs,
    trace,
    payload
  };
}
