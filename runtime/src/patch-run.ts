import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

import {
  SAFE_DIFF_PLAN_ARTIFACT_TYPE,
  SAFE_DIFF_PLAN_EDIT_OPERATIONS,
  SAFE_DIFF_PLAN_REASON_CODES,
  SAFE_DIFF_PLAN_SCHEMA_VERSION,
  type SafeDiffPlanArtifactV1,
  type SafeDiffPlanEditOperation
} from "./safe-diff-plan.ts";

export const PATCH_RUN_ARTIFACT_TYPE = "ls.m2.patch_run";
export const PATCH_RUN_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_PATCH_RUN_TOOL_VERSION = "@l-semantica/runtime@0.1.0";
export const DEFAULT_PATCH_RUN_MATERIALIZATION = "deterministic_text_patch_v1";
export const DEFAULT_PATCH_RUN_REQUIRED_CHECKS = ["lint", "typecheck", "test"] as const;
export const DEFAULT_PATCH_RUN_POLICY_SENSITIVE_PATH_PATTERNS = [
  ".github/workflows/**",
  ".github/actions/**",
  "docs/spec/schemas/**",
  "docs/spec/policyprofile-*.md",
  "docs/spec/verificationcontract-*.md"
] as const;
export const PATCH_RUN_DECISIONS = ["continue", "escalate", "stop"] as const;
export const PATCH_RUN_REASON_CODES = [
  "ok",
  "unsupported_input",
  "mapping_ambiguous",
  "mapping_low_confidence",
  "forbidden_path",
  "change_bound_exceeded",
  "conflict_detected",
  "verification_failed",
  "verification_incomplete",
  "policy_blocked"
] as const;
export const PATCH_RUN_FORMATS = ["unified_diff"] as const;
export const PATCH_RUN_CHECK_STATUSES = ["pass", "fail", "not_run"] as const;

const SAFE_DIFF_PLAN_REASON_CODE_SET = new Set<string>(SAFE_DIFF_PLAN_REASON_CODES);
const SAFE_DIFF_PLAN_EDIT_OPERATION_SET = new Set<string>(SAFE_DIFF_PLAN_EDIT_OPERATIONS);
const PATCH_RUN_REASON_CODE_SET = new Set<string>(PATCH_RUN_REASON_CODES);
const PATH_GLOB_REGEX_CACHE = new Map<string, RegExp>();

export type PatchRunDecision = (typeof PATCH_RUN_DECISIONS)[number];
export type PatchRunReasonCode = (typeof PATCH_RUN_REASON_CODES)[number];
export type PatchRunFormat = (typeof PATCH_RUN_FORMATS)[number];
export type PatchRunCheckStatus = (typeof PATCH_RUN_CHECK_STATUSES)[number];

export type PatchRunErrorCode = "INVALID_SAFE_DIFF_PLAN" | "INVALID_OPTIONS";

export class PatchRunError extends Error {
  readonly code: PatchRunErrorCode;

  constructor(message: string, code: PatchRunErrorCode) {
    super(message);
    this.name = "PatchRunError";
    this.code = code;
  }
}

export interface PatchRunArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface PatchRunVerificationResult {
  check: string;
  status: PatchRunCheckStatus;
  evidence_ref?: string;
  detail?: string;
}

export interface PatchRunPatch {
  format: PatchRunFormat;
  content: string;
  file_count: number;
  hunk_count: number;
}

export interface PatchRunArtifactV1 {
  artifact_type: typeof PATCH_RUN_ARTIFACT_TYPE;
  schema_version: typeof PATCH_RUN_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: PatchRunArtifactInputRef[];
  trace: {
    patch_materialization: string;
  };
  payload: {
    patch: PatchRunPatch;
    patch_digest: string;
    verification: {
      required_checks: string[];
      results: PatchRunVerificationResult[];
      checks_complete: boolean;
      evidence_complete: boolean;
      all_required_passed: boolean;
      missing_required_checks: string[];
      incomplete_checks: string[];
      failing_checks: string[];
    };
    decision: PatchRunDecision;
    reason_code: PatchRunReasonCode;
    reason_detail: string;
  };
}

export interface PatchRunDraftVerificationResult {
  check: string;
  status?: PatchRunCheckStatus;
  evidence_ref?: string;
  detail?: string;
}

export interface CreatePatchRunArtifactOptions {
  safeDiffPlan: SafeDiffPlanArtifactV1;
  patchMaterialization?: string;
  requiredChecks?: string[];
  verificationResults?: PatchRunDraftVerificationResult[];
  policySensitivePathPatterns?: string[];
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface NormalizedSafeDiffPlanEdit {
  path: string;
  operation: SafeDiffPlanEditOperation;
  justification: string;
  targetId?: string;
  symbolPath?: string | null;
}

interface NormalizedSafeDiffPlanInput {
  inputRef: PatchRunArtifactInputRef;
  runId: string;
  decision: SafeDiffPlanArtifactV1["payload"]["decision"];
  reasonCode: string;
  reasonDetail: string;
  edits: NormalizedSafeDiffPlanEdit[];
}

interface VerificationEvaluation {
  results: PatchRunVerificationResult[];
  checksComplete: boolean;
  evidenceComplete: boolean;
  allRequiredPassed: boolean;
  missingRequiredChecks: string[];
  incompleteChecks: string[];
  failingChecks: string[];
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePatchMaterialization(value: unknown): string {
  return normalizeOptionalNonEmptyString(value) ?? DEFAULT_PATCH_RUN_MATERIALIZATION;
}

function normalizeRequiredChecks(value: unknown): string[] {
  if (value === undefined) {
    return [...DEFAULT_PATCH_RUN_REQUIRED_CHECKS];
  }

  if (!Array.isArray(value)) {
    throw new PatchRunError(
      "Patch run requiredChecks must be an array of non-empty strings",
      "INVALID_OPTIONS"
    );
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const check = normalizeOptionalNonEmptyString(item);
    if (!check) {
      throw new PatchRunError(
        "Patch run requiredChecks must contain non-empty strings",
        "INVALID_OPTIONS"
      );
    }

    if (!seen.has(check)) {
      seen.add(check);
      normalized.push(check);
    }
  }

  if (normalized.length === 0) {
    throw new PatchRunError(
      "Patch run requiredChecks must include at least one required check",
      "INVALID_OPTIONS"
    );
  }

  return [...normalized].sort((left, right) => left.localeCompare(right));
}

function normalizePatchRunCheckStatus(value: unknown): PatchRunCheckStatus {
  if (value === undefined) {
    return "not_run";
  }

  if (value !== "pass" && value !== "fail" && value !== "not_run") {
    throw new PatchRunError(
      "Patch run verification result status must be one of pass, fail, or not_run",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeVerificationResults(value: unknown): PatchRunVerificationResult[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new PatchRunError(
      "Patch run verificationResults must be an array when provided",
      "INVALID_OPTIONS"
    );
  }

  const seenChecks = new Set<string>();
  const results = value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PatchRunError(
        `Patch run verificationResults[${String(index)}] must be an object`,
        "INVALID_OPTIONS"
      );
    }

    const result = item as Partial<PatchRunDraftVerificationResult>;
    const check = normalizeOptionalNonEmptyString(result.check);
    if (!check) {
      throw new PatchRunError(
        `Patch run verificationResults[${String(index)}].check must be a non-empty string`,
        "INVALID_OPTIONS"
      );
    }

    if (seenChecks.has(check)) {
      throw new PatchRunError(
        `Patch run verificationResults contains duplicate check "${check}"`,
        "INVALID_OPTIONS"
      );
    }
    seenChecks.add(check);

    const status = normalizePatchRunCheckStatus(result.status);
    const evidenceRef = normalizeOptionalNonEmptyString(result.evidence_ref);
    const detail = normalizeOptionalNonEmptyString(result.detail);

    return {
      check,
      status,
      ...(evidenceRef ? { evidence_ref: evidenceRef } : {}),
      ...(detail ? { detail } : {})
    };
  });

  return results.sort((left, right) => left.check.localeCompare(right.check));
}

function normalizePolicySensitivePathPatterns(value: unknown): string[] {
  if (value === undefined) {
    return [...DEFAULT_PATCH_RUN_POLICY_SENSITIVE_PATH_PATTERNS];
  }

  if (!Array.isArray(value)) {
    throw new PatchRunError(
      "Patch run policySensitivePathPatterns must be an array of non-empty strings",
      "INVALID_OPTIONS"
    );
  }

  return Array.from(
    new Set(
      value.map((pattern) => {
        const normalized = normalizeOptionalNonEmptyString(pattern);
        if (!normalized) {
          throw new PatchRunError(
            "Patch run policySensitivePathPatterns must contain non-empty strings",
            "INVALID_OPTIONS"
          );
        }

        return normalized.replace(/\\/g, "/");
      })
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizePatchPath(value: unknown, context: string): string {
  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new PatchRunError(`${context} must include a non-empty path`, "INVALID_SAFE_DIFF_PLAN");
  }

  const withForwardSlashes = normalized.replace(/\\/g, "/");
  const pathValue = posix.normalize(withForwardSlashes);
  if (pathValue === ".") {
    throw new PatchRunError(`${context} path must not be '.'`, "INVALID_SAFE_DIFF_PLAN");
  }

  const trimmed = pathValue.replace(/^\.\/+/, "");
  if (
    trimmed.startsWith("/") ||
    /^[A-Za-z]:\//.test(trimmed) ||
    trimmed === ".." ||
    trimmed.startsWith("../")
  ) {
    throw new PatchRunError(`${context} path must remain within workspace-relative bounds`, "INVALID_SAFE_DIFF_PLAN");
  }

  return trimmed;
}

function normalizeSafeDiffPlanEdit(value: unknown, index: number): NormalizedSafeDiffPlanEdit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PatchRunError(
      `Patch run safe diff plan payload.edits[${String(index)}] must be an object`,
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const edit = value as {
    path?: unknown;
    operation?: unknown;
    justification?: unknown;
    target_id?: unknown;
    symbol_path?: unknown;
  };
  const path = normalizePatchPath(edit.path, `Patch run safe diff plan payload.edits[${String(index)}]`);
  const operation = edit.operation;
  if (!SAFE_DIFF_PLAN_EDIT_OPERATION_SET.has(String(operation ?? ""))) {
    throw new PatchRunError(
      "Patch run safe diff plan payload.edits operation is unsupported for the pinned schema version",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const justification = normalizeOptionalNonEmptyString(edit.justification);
  if (!justification) {
    throw new PatchRunError(
      `Patch run safe diff plan payload.edits[${String(index)}].justification is required`,
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const targetId = normalizeOptionalNonEmptyString(edit.target_id);
  const symbolPath =
    edit.symbol_path === null
      ? null
      : normalizeOptionalNonEmptyString(edit.symbol_path);

  return {
    path,
    operation: operation as SafeDiffPlanEditOperation,
    justification,
    ...(targetId ? { targetId } : {}),
    ...(edit.symbol_path !== undefined ? { symbolPath: symbolPath ?? null } : {})
  };
}

function normalizeSafeDiffPlanArtifact(input: unknown): NormalizedSafeDiffPlanInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PatchRunError(
      "Patch run requires a safe diff plan artifact object",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const plan = input as Partial<SafeDiffPlanArtifactV1>;
  if (plan.artifact_type !== SAFE_DIFF_PLAN_ARTIFACT_TYPE) {
    throw new PatchRunError(
      `Patch run requires ${SAFE_DIFF_PLAN_ARTIFACT_TYPE} input`,
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  if (plan.schema_version !== SAFE_DIFF_PLAN_SCHEMA_VERSION) {
    throw new PatchRunError(
      `Patch run requires ${SAFE_DIFF_PLAN_ARTIFACT_TYPE}@${SAFE_DIFF_PLAN_SCHEMA_VERSION}`,
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(plan.artifact_id);
  const runId = normalizeOptionalNonEmptyString(plan.run_id);
  if (!artifactId || !runId) {
    throw new PatchRunError(
      "Patch run safe diff plan is missing required envelope fields",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const payload = plan.payload as
    | {
        edits?: unknown;
        decision?: unknown;
        reason_code?: unknown;
        reason_detail?: unknown;
      }
    | undefined;

  const decision = payload?.decision;
  if (decision !== "continue" && decision !== "escalate" && decision !== "stop") {
    throw new PatchRunError(
      "Patch run safe diff plan payload.decision must be continue, escalate, or stop",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const reasonCode = normalizeOptionalNonEmptyString(payload?.reason_code);
  const reasonDetail = normalizeOptionalNonEmptyString(payload?.reason_detail);
  if (!reasonCode || !reasonDetail) {
    throw new PatchRunError(
      "Patch run safe diff plan payload.reason_code and payload.reason_detail are required",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  if (!SAFE_DIFF_PLAN_REASON_CODE_SET.has(reasonCode)) {
    throw new PatchRunError(
      "Patch run safe diff plan payload.reason_code is unsupported for the pinned schema version",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  if (!Array.isArray(payload?.edits)) {
    throw new PatchRunError(
      "Patch run safe diff plan payload.edits must be an array",
      "INVALID_SAFE_DIFF_PLAN"
    );
  }

  const edits = payload.edits.map((edit, index) => normalizeSafeDiffPlanEdit(edit, index));

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: plan.artifact_type,
      schema_version: plan.schema_version
    },
    runId,
    decision,
    reasonCode,
    reasonDetail,
    edits
  };
}

function normalizeForPatchLine(value: string, maxLength = 180): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function buildPatchMetadataLabel(edit: NormalizedSafeDiffPlanEdit): string {
  const symbolLabel =
    edit.symbolPath === undefined
      ? "symbol:unspecified"
      : edit.symbolPath === null
        ? "symbol:file"
        : `symbol:${normalizeForPatchLine(edit.symbolPath, 96)}`;
  const targetLabel = edit.targetId ? `target:${normalizeForPatchLine(edit.targetId, 96)}` : "target:none";
  const justificationLabel = `why:${normalizeForPatchLine(edit.justification, 120)}`;

  return [symbolLabel, targetLabel, justificationLabel].join(" | ");
}

function buildPatchChunkForEdit(edit: NormalizedSafeDiffPlanEdit): string {
  const metadata = buildPatchMetadataLabel(edit);

  if (edit.operation === "create") {
    return [
      `diff --git a/${edit.path} b/${edit.path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${edit.path}`,
      "@@ -0,0 +1 @@",
      `+__ls_m2_patch_run_create__ ${metadata}`
    ].join("\n");
  }

  if (edit.operation === "delete") {
    return [
      `diff --git a/${edit.path} b/${edit.path}`,
      "deleted file mode 100644",
      `--- a/${edit.path}`,
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      `-__ls_m2_patch_run_delete__ ${metadata}`
    ].join("\n");
  }

  return [
    `diff --git a/${edit.path} b/${edit.path}`,
    `--- a/${edit.path}`,
    `+++ b/${edit.path}`,
    "@@ -1 +1 @@",
    "-__ls_m2_patch_run_before__",
    `+__ls_m2_patch_run_after__ ${metadata}`
  ].join("\n");
}

function buildPatchContent(edits: NormalizedSafeDiffPlanEdit[]): string {
  if (edits.length === 0) {
    return "";
  }

  return `${edits.map((edit) => buildPatchChunkForEdit(edit)).join("\n\n")}\n`;
}

function buildPatchDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function evaluateVerification(
  requiredChecks: string[],
  results: PatchRunVerificationResult[]
): VerificationEvaluation {
  const resultByCheck = new Map(results.map((result) => [result.check, result]));
  const missingRequiredChecks: string[] = [];
  const failingChecks = new Set<string>();
  const incompleteChecks = new Set<string>();
  let evidenceComplete = true;
  let checksComplete = true;
  let allRequiredPassed = true;

  for (const check of requiredChecks) {
    const result = resultByCheck.get(check);
    if (!result) {
      missingRequiredChecks.push(check);
      incompleteChecks.add(check);
      checksComplete = false;
      evidenceComplete = false;
      allRequiredPassed = false;
      continue;
    }

    if (!result.evidence_ref) {
      evidenceComplete = false;
      incompleteChecks.add(check);
    }

    if (result.status === "not_run") {
      checksComplete = false;
      incompleteChecks.add(check);
      allRequiredPassed = false;
      continue;
    }

    if (result.status === "fail") {
      failingChecks.add(check);
      allRequiredPassed = false;
    }
  }

  return {
    results,
    checksComplete,
    evidenceComplete,
    allRequiredPassed,
    missingRequiredChecks,
    incompleteChecks: [...incompleteChecks].sort((left, right) => left.localeCompare(right)),
    failingChecks: [...failingChecks].sort((left, right) => left.localeCompare(right))
  };
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
        expression += ".*";
        index += 1;
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

function collectPolicySensitivePaths(
  edits: NormalizedSafeDiffPlanEdit[],
  patterns: string[]
): string[] {
  const matches = new Set<string>();

  for (const edit of edits) {
    for (const pattern of patterns) {
      if (
        globPatternToRegex(pattern).test(edit.path) ||
        (pattern.endsWith("/**") && edit.path === pattern.slice(0, -3))
      ) {
        matches.add(edit.path);
        break;
      }
    }
  }

  return [...matches].sort((left, right) => left.localeCompare(right));
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
  return normalizeOptionalNonEmptyString(toolVersion) ?? DEFAULT_PATCH_RUN_TOOL_VERSION;
}

function buildArtifactDigest(input: {
  inputRef: PatchRunArtifactInputRef;
  trace: PatchRunArtifactV1["trace"];
  payload: PatchRunArtifactV1["payload"];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inputs: [input.inputRef],
        trace: input.trace,
        payload: input.payload
      })
    )
    .digest("hex");
}

function formatVerificationIncompleteReason(
  verification: VerificationEvaluation
): string {
  const detailParts: string[] = [];

  if (verification.missingRequiredChecks.length > 0) {
    detailParts.push(
      `missing required checks: ${verification.missingRequiredChecks.join(", ")}`
    );
  }

  if (verification.incompleteChecks.length > 0) {
    const missingEvidenceOnly = verification.incompleteChecks.filter(
      (check) =>
        !verification.missingRequiredChecks.includes(check) &&
        !verification.results.find((result) => result.check === check && result.status === "not_run")
    );
    const notRunChecks = verification.incompleteChecks.filter((check) =>
      verification.results.find((result) => result.check === check && result.status === "not_run")
    );

    if (notRunChecks.length > 0) {
      detailParts.push(`not-run required checks: ${notRunChecks.join(", ")}`);
    }

    if (missingEvidenceOnly.length > 0) {
      detailParts.push(`missing evidence links for: ${missingEvidenceOnly.join(", ")}`);
    }
  }

  const summary = detailParts.length > 0 ? detailParts.join("; ") : "required verification evidence is incomplete";
  return `Required verification evidence is incomplete: ${summary}.`;
}

export function createPatchRunArtifact(
  options: CreatePatchRunArtifactOptions
): PatchRunArtifactV1 {
  if (typeof options !== "object" || options === null) {
    throw new PatchRunError("Patch run options must be an object", "INVALID_OPTIONS");
  }

  const safeDiffPlan = normalizeSafeDiffPlanArtifact(options.safeDiffPlan);
  const patchMaterialization = normalizePatchMaterialization(options.patchMaterialization);
  const requiredChecks = normalizeRequiredChecks(options.requiredChecks);
  const verificationResults = normalizeVerificationResults(options.verificationResults);
  const policySensitivePathPatterns = normalizePolicySensitivePathPatterns(options.policySensitivePathPatterns);

  let patchEdits: NormalizedSafeDiffPlanEdit[] = [];
  let decision: PatchRunDecision = "stop";
  let reasonCode: PatchRunReasonCode = "unsupported_input";
  let reasonDetail = "Patch generation did not run.";

  if (safeDiffPlan.decision !== "continue") {
    decision = safeDiffPlan.decision;
    if (!PATCH_RUN_REASON_CODE_SET.has(safeDiffPlan.reasonCode)) {
      throw new PatchRunError(
        "Patch run safe diff plan reason_code cannot be propagated by the pinned schema version",
        "INVALID_SAFE_DIFF_PLAN"
      );
    }
    reasonCode = safeDiffPlan.reasonCode as PatchRunReasonCode;
    reasonDetail = `Safe diff plan blocked patch generation: ${safeDiffPlan.reasonDetail}`;
  } else if (safeDiffPlan.edits.length === 0) {
    decision = "stop";
    reasonCode = "unsupported_input";
    reasonDetail = "Safe diff plan continue decision did not include any edits to materialize.";
  } else {
    patchEdits = safeDiffPlan.edits;
  }

  const patchContent = buildPatchContent(patchEdits);
  const patchDigest = buildPatchDigest(patchContent);
  const patch: PatchRunPatch = {
    format: "unified_diff",
    content: patchContent,
    file_count: new Set(patchEdits.map((edit) => edit.path)).size,
    hunk_count: patchEdits.length
  };

  const verification = evaluateVerification(requiredChecks, verificationResults);

  if (patchEdits.length > 0 && decision === "stop" && reasonCode === "unsupported_input") {
    if (!verification.checksComplete || !verification.evidenceComplete) {
      decision = "stop";
      reasonCode = "verification_incomplete";
      reasonDetail = formatVerificationIncompleteReason(verification);
    } else if (!verification.allRequiredPassed) {
      decision = "stop";
      reasonCode = "verification_failed";
      reasonDetail = `Required verification checks failed: ${verification.failingChecks.join(", ")}.`;
    } else {
      const policySensitivePaths = collectPolicySensitivePaths(patchEdits, policySensitivePathPatterns);
      if (policySensitivePaths.length > 0) {
        decision = "escalate";
        reasonCode = "policy_blocked";
        reasonDetail = `Patch targets policy-sensitive paths requiring human review: ${policySensitivePaths.join(", ")}.`;
      } else {
        decision = "continue";
        reasonCode = "ok";
        reasonDetail = "All required checks passed with complete evidence";
      }
    }
  }

  const trace: PatchRunArtifactV1["trace"] = {
    patch_materialization: patchMaterialization
  };

  const payload: PatchRunArtifactV1["payload"] = {
    patch,
    patch_digest: patchDigest,
    verification: {
      required_checks: requiredChecks,
      results: verification.results,
      checks_complete: verification.checksComplete,
      evidence_complete: verification.evidenceComplete,
      all_required_passed: verification.allRequiredPassed,
      missing_required_checks: verification.missingRequiredChecks,
      incomplete_checks: verification.incompleteChecks,
      failing_checks: verification.failingChecks
    },
    decision,
    reason_code: reasonCode,
    reason_detail: reasonDetail
  };

  const artifactDigest = buildArtifactDigest({
    inputRef: safeDiffPlan.inputRef,
    trace,
    payload
  });

  return {
    artifact_type: PATCH_RUN_ARTIFACT_TYPE,
    schema_version: PATCH_RUN_SCHEMA_VERSION,
    artifact_id: `patch_${artifactDigest.slice(0, 12)}`,
    run_id: resolveRunId(safeDiffPlan.runId, options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs: [safeDiffPlan.inputRef],
    trace,
    payload
  };
}
