import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

import {
  INTENT_MAPPING_ARTIFACT_TYPE,
  INTENT_MAPPING_REASON_CODES,
  INTENT_MAPPING_SCHEMA_VERSION,
  type IntentMappingArtifactV1
} from "./intent-mapping.ts";

export const SAFE_DIFF_PLAN_ARTIFACT_TYPE = "ls.m2.safe_diff_plan";
export const SAFE_DIFF_PLAN_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_SAFE_DIFF_PLAN_TOOL_VERSION = "@l-semantica/runtime@0.1.0";
export const DEFAULT_SAFE_DIFF_PLAN_PLANNER_PROFILE = "default-conservative";
export const DEFAULT_SAFE_DIFF_PLAN_FORBIDDEN_PATH_PATTERNS = [
  ".git/**",
  "node_modules/**",
  ".env*",
  "**/.env*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key"
] as const;
export const DEFAULT_SAFE_DIFF_PLAN_MAX_FILE_CHANGES = 5;
export const DEFAULT_SAFE_DIFF_PLAN_MAX_HUNKS = 20;
export const SAFE_DIFF_PLAN_DECISIONS = ["continue", "escalate", "stop"] as const;
export const SAFE_DIFF_PLAN_REASON_CODES = [
  "ok",
  "unsupported_input",
  "mapping_ambiguous",
  "mapping_low_confidence",
  "forbidden_path",
  "change_bound_exceeded",
  "conflict_detected"
] as const;
export const SAFE_DIFF_PLAN_EDIT_OPERATIONS = ["create", "modify", "delete"] as const;

const PATH_GLOB_REGEX_CACHE = new Map<string, RegExp>();
const INTENT_MAPPING_REASON_CODE_SET = new Set<string>(INTENT_MAPPING_REASON_CODES);

export type SafeDiffPlanDecision = (typeof SAFE_DIFF_PLAN_DECISIONS)[number];
export type SafeDiffPlanReasonCode = (typeof SAFE_DIFF_PLAN_REASON_CODES)[number];
export type SafeDiffPlanEditOperation = (typeof SAFE_DIFF_PLAN_EDIT_OPERATIONS)[number];

export type SafeDiffPlanErrorCode = "INVALID_INTENT_MAPPING" | "INVALID_OPTIONS";

export class SafeDiffPlanError extends Error {
  readonly code: SafeDiffPlanErrorCode;

  constructor(message: string, code: SafeDiffPlanErrorCode) {
    super(message);
    this.name = "SafeDiffPlanError";
    this.code = code;
  }
}

export interface SafeDiffPlanArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface SafeDiffPlanEdit {
  path: string;
  operation: SafeDiffPlanEditOperation;
  justification: string;
  target_id?: string;
  symbol_path?: string | null;
}

export interface SafeDiffPlanArtifactV1 {
  artifact_type: typeof SAFE_DIFF_PLAN_ARTIFACT_TYPE;
  schema_version: typeof SAFE_DIFF_PLAN_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: SafeDiffPlanArtifactInputRef[];
  trace: {
    planner_profile: string;
  };
  payload: {
    edits: SafeDiffPlanEdit[];
    safety_checks: {
      forbidden_path_patterns: string[];
      max_file_changes: {
        limit: number;
        observed: number;
      };
      max_hunks: {
        limit: number;
        observed: number;
      };
    };
    decision: SafeDiffPlanDecision;
    reason_code: SafeDiffPlanReasonCode;
    reason_detail: string;
  };
}

export interface SafeDiffPlanDraftEdit {
  path: string;
  operation?: SafeDiffPlanEditOperation;
  justification?: string;
  target_id?: string;
  symbol_path?: string | null;
}

export interface CreateSafeDiffPlanArtifactOptions {
  intentMapping: IntentMappingArtifactV1;
  plannerProfile?: string;
  forbiddenPathPatterns?: string[];
  maxFileChanges?: number;
  maxHunks?: number;
  plannedEdits?: SafeDiffPlanDraftEdit[];
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface NormalizedIntentMappingCandidate {
  targetId: string;
  path: string;
  symbolPath: string | null;
}

interface NormalizedIntentMappingInput {
  inputRef: SafeDiffPlanArtifactInputRef;
  runId: string;
  intentSummary: string;
  decision: IntentMappingArtifactV1["payload"]["decision"];
  reasonCode: string;
  reasonDetail: string;
  candidates: NormalizedIntentMappingCandidate[];
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePlannerProfile(value: unknown): string {
  return normalizeOptionalNonEmptyString(value) ?? DEFAULT_SAFE_DIFF_PLAN_PLANNER_PROFILE;
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  optionName: "maxFileChanges" | "maxHunks"
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10_000
  ) {
    throw new SafeDiffPlanError(
      `Safe diff plan ${optionName} must be an integer between 1 and 10000`,
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeForbiddenPathPatterns(value: unknown): string[] {
  if (value === undefined) {
    return [...DEFAULT_SAFE_DIFF_PLAN_FORBIDDEN_PATH_PATTERNS];
  }

  if (!Array.isArray(value)) {
    throw new SafeDiffPlanError(
      "Safe diff plan forbiddenPathPatterns must be an array of non-empty strings",
      "INVALID_OPTIONS"
    );
  }

  return Array.from(
    new Set(
      value.map((pattern) => {
        const normalized = normalizeOptionalNonEmptyString(pattern);
        if (!normalized) {
          throw new SafeDiffPlanError(
            "Safe diff plan forbiddenPathPatterns must contain non-empty strings",
            "INVALID_OPTIONS"
          );
        }

        return normalized.replace(/\\/g, "/");
      })
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeEditPath(value: unknown): string {
  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new SafeDiffPlanError(
      "Safe diff plan edits must include a non-empty path",
      "INVALID_OPTIONS"
    );
  }

  const withForwardSlashes = normalized.replace(/\\/g, "/");
  const pathValue = posix.normalize(withForwardSlashes);
  if (pathValue === ".") {
    throw new SafeDiffPlanError(
      "Safe diff plan edits must include a file path, not '.'",
      "INVALID_OPTIONS"
    );
  }

  return pathValue.replace(/^\.\/+/, "");
}

function normalizeEditOperation(value: unknown): SafeDiffPlanEditOperation {
  if (value === undefined) {
    return "modify";
  }

  if (
    value !== "create" &&
    value !== "modify" &&
    value !== "delete"
  ) {
    throw new SafeDiffPlanError(
      "Safe diff plan edit operation must be one of create, modify, or delete",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeEditSymbolPath(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new SafeDiffPlanError(
      "Safe diff plan edit symbol_path must be null or a non-empty string",
      "INVALID_OPTIONS"
    );
  }

  return normalized;
}

function normalizePlannedEdits(value: unknown): SafeDiffPlanEdit[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new SafeDiffPlanError(
      "Safe diff plan plannedEdits must be an array when provided",
      "INVALID_OPTIONS"
    );
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new SafeDiffPlanError(
        `Safe diff plan plannedEdits[${String(index)}] must be an object`,
        "INVALID_OPTIONS"
      );
    }

    const edit = item as Partial<SafeDiffPlanDraftEdit>;
    const path = normalizeEditPath(edit.path);
    const operation = normalizeEditOperation(edit.operation);
    const justification =
      normalizeOptionalNonEmptyString(edit.justification) ??
      `Planner override requested ${operation} on ${path}.`;
    const targetId = normalizeOptionalNonEmptyString(edit.target_id);
    const symbolPath = normalizeEditSymbolPath(edit.symbol_path);

    return {
      path,
      operation,
      justification,
      ...(targetId ? { target_id: targetId } : {}),
      ...(symbolPath !== undefined ? { symbol_path: symbolPath } : {})
    };
  });
}

function normalizeIntentMappingCandidate(
  value: unknown,
  context: string
): NormalizedIntentMappingCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SafeDiffPlanError(
      `Safe diff plan ${context} must contain candidate objects`,
      "INVALID_INTENT_MAPPING"
    );
  }

  const candidate = value as {
    target_id?: unknown;
    path?: unknown;
    symbol_path?: unknown;
  };
  const targetId = normalizeOptionalNonEmptyString(candidate.target_id);
  const path = normalizeOptionalNonEmptyString(candidate.path);
  const symbolPath =
    candidate.symbol_path === null
      ? null
      : normalizeOptionalNonEmptyString(candidate.symbol_path);

  if (!targetId || !path) {
    throw new SafeDiffPlanError(
      `Safe diff plan ${context} candidate is missing target_id or path`,
      "INVALID_INTENT_MAPPING"
    );
  }

  return {
    targetId,
    path,
    symbolPath: symbolPath ?? null
  };
}

function normalizeIntentMappingArtifact(input: unknown): NormalizedIntentMappingInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SafeDiffPlanError(
      "Safe diff plan requires an intent mapping artifact object",
      "INVALID_INTENT_MAPPING"
    );
  }

  const mapping = input as Partial<IntentMappingArtifactV1>;
  if (mapping.artifact_type !== INTENT_MAPPING_ARTIFACT_TYPE) {
    throw new SafeDiffPlanError(
      `Safe diff plan requires ${INTENT_MAPPING_ARTIFACT_TYPE} input`,
      "INVALID_INTENT_MAPPING"
    );
  }

  if (mapping.schema_version !== INTENT_MAPPING_SCHEMA_VERSION) {
    throw new SafeDiffPlanError(
      `Safe diff plan requires ${INTENT_MAPPING_ARTIFACT_TYPE}@${INTENT_MAPPING_SCHEMA_VERSION}`,
      "INVALID_INTENT_MAPPING"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(mapping.artifact_id);
  const runId = normalizeOptionalNonEmptyString(mapping.run_id);
  if (!artifactId || !runId) {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping is missing required envelope fields",
      "INVALID_INTENT_MAPPING"
    );
  }

  const payload = mapping.payload as
    | {
        intent?: { summary?: unknown };
        candidates?: unknown;
        decision?: unknown;
        reason_code?: unknown;
        reason_detail?: unknown;
      }
    | undefined;
  const intentSummary = normalizeOptionalNonEmptyString(payload?.intent?.summary);
  if (!intentSummary) {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping payload.intent.summary is required",
      "INVALID_INTENT_MAPPING"
    );
  }

  const decision = payload?.decision;
  if (decision !== "continue" && decision !== "escalate" && decision !== "stop") {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping payload.decision must be continue, escalate, or stop",
      "INVALID_INTENT_MAPPING"
    );
  }

  const reasonCode = normalizeOptionalNonEmptyString(payload?.reason_code);
  const reasonDetail = normalizeOptionalNonEmptyString(payload?.reason_detail);
  if (!reasonCode || !reasonDetail) {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping payload.reason_code and payload.reason_detail are required",
      "INVALID_INTENT_MAPPING"
    );
  }

  if (!INTENT_MAPPING_REASON_CODE_SET.has(reasonCode)) {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping payload.reason_code is unsupported for the pinned schema version",
      "INVALID_INTENT_MAPPING"
    );
  }

  if (!Array.isArray(payload?.candidates)) {
    throw new SafeDiffPlanError(
      "Safe diff plan intent mapping payload.candidates must be an array",
      "INVALID_INTENT_MAPPING"
    );
  }

  const candidates = payload.candidates.map((candidate, index) =>
    normalizeIntentMappingCandidate(candidate, `payload.candidates[${String(index)}]`)
  );

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: mapping.artifact_type,
      schema_version: mapping.schema_version
    },
    runId,
    intentSummary,
    decision,
    reasonCode,
    reasonDetail,
    candidates
  };
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferEditOperation(intentSummary: string): SafeDiffPlanEditOperation {
  const normalizedIntent = normalizeForSearch(intentSummary);
  if (/\b(delete|remove)\b/.test(normalizedIntent)) {
    return "delete";
  }

  if (/\b(create|new)\b/.test(normalizedIntent)) {
    return "create";
  }

  if (
    /\badd\b/.test(normalizedIntent) &&
    /\b(?:file|section|entry|field|rule|check|capability|goal)\b/.test(normalizedIntent)
  ) {
    return "create";
  }

  return "modify";
}

function buildDefaultPlannedEdits(mapping: NormalizedIntentMappingInput): SafeDiffPlanEdit[] {
  if (mapping.candidates.length === 0) {
    return [];
  }

  if (mapping.candidates.length > 1) {
    return [];
  }

  const candidate = mapping.candidates[0];
  if (!candidate) {
    return [];
  }

  const operation = inferEditOperation(mapping.intentSummary);
  const targetLabel = candidate.symbolPath ? `${candidate.path}#${candidate.symbolPath}` : candidate.path;

  return [
    {
      path: normalizeEditPath(candidate.path),
      operation,
      justification: `Mapped intent to ${targetLabel} for conservative ${operation} planning.`,
      target_id: candidate.targetId,
      symbol_path: candidate.symbolPath
    }
  ];
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
  return normalizeOptionalNonEmptyString(toolVersion) ?? DEFAULT_SAFE_DIFF_PLAN_TOOL_VERSION;
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

function isPathOutsideRelativeBounds(pathValue: string): boolean {
  if (pathValue.startsWith("/")) {
    return true;
  }

  if (/^[A-Za-z]:\//.test(pathValue)) {
    return true;
  }

  return pathValue === ".." || pathValue.startsWith("../");
}

function collectForbiddenPaths(edits: SafeDiffPlanEdit[], forbiddenPatterns: string[]): string[] {
  const blocked = new Set<string>();

  for (const edit of edits) {
    if (isPathOutsideRelativeBounds(edit.path)) {
      blocked.add(edit.path);
      continue;
    }

    for (const pattern of forbiddenPatterns) {
      if (
        globPatternToRegex(pattern).test(edit.path) ||
        (pattern.endsWith("/**") && edit.path === pattern.slice(0, -3))
      ) {
        blocked.add(edit.path);
        break;
      }
    }
  }

  return [...blocked].sort((left, right) => left.localeCompare(right));
}

function collectConflictPaths(edits: SafeDiffPlanEdit[]): string[] {
  const counts = new Map<string, number>();

  for (const edit of edits) {
    counts.set(edit.path, (counts.get(edit.path) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path]) => path)
    .sort((left, right) => left.localeCompare(right));
}

function buildSafetyChecks(
  edits: SafeDiffPlanEdit[],
  forbiddenPathPatterns: string[],
  maxFileChanges: number,
  maxHunks: number
): SafeDiffPlanArtifactV1["payload"]["safety_checks"] {
  const observedFileChanges = new Set(edits.map((edit) => edit.path)).size;
  const observedHunks = edits.length;

  return {
    forbidden_path_patterns: forbiddenPathPatterns,
    max_file_changes: {
      limit: maxFileChanges,
      observed: observedFileChanges
    },
    max_hunks: {
      limit: maxHunks,
      observed: observedHunks
    }
  };
}

function buildArtifactDigest(input: {
  inputRef: SafeDiffPlanArtifactInputRef;
  trace: SafeDiffPlanArtifactV1["trace"];
  payload: SafeDiffPlanArtifactV1["payload"];
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

function normalizePlannerReasonCodeFromMapping(
  decision: IntentMappingArtifactV1["payload"]["decision"],
  reasonCode: string
): SafeDiffPlanReasonCode {
  if (reasonCode === "mapping_ambiguous" || reasonCode === "mapping_low_confidence") {
    return reasonCode;
  }

  if (decision === "stop") {
    return "unsupported_input";
  }

  return "conflict_detected";
}

export function createSafeDiffPlanArtifact(
  options: CreateSafeDiffPlanArtifactOptions
): SafeDiffPlanArtifactV1 {
  if (typeof options !== "object" || options === null) {
    throw new SafeDiffPlanError("Safe diff plan options must be an object", "INVALID_OPTIONS");
  }

  const intentMapping = normalizeIntentMappingArtifact(options.intentMapping);
  const plannerProfile = normalizePlannerProfile(options.plannerProfile);
  const forbiddenPathPatterns = normalizeForbiddenPathPatterns(options.forbiddenPathPatterns);
  const maxFileChanges = normalizePositiveInteger(
    options.maxFileChanges,
    DEFAULT_SAFE_DIFF_PLAN_MAX_FILE_CHANGES,
    "maxFileChanges"
  );
  const maxHunks = normalizePositiveInteger(
    options.maxHunks,
    DEFAULT_SAFE_DIFF_PLAN_MAX_HUNKS,
    "maxHunks"
  );
  const trace: SafeDiffPlanArtifactV1["trace"] = {
    planner_profile: plannerProfile
  };

  let edits: SafeDiffPlanEdit[] = [];
  let decision: SafeDiffPlanDecision = "stop";
  let reasonCode: SafeDiffPlanReasonCode = "unsupported_input";
  let reasonDetail = "No safe diff edits were generated.";

  if (intentMapping.decision !== "continue") {
    decision = intentMapping.decision;
    reasonCode = normalizePlannerReasonCodeFromMapping(intentMapping.decision, intentMapping.reasonCode);
    reasonDetail = `Intent mapping blocked diff planning: ${intentMapping.reasonDetail}`;
  } else if (intentMapping.candidates.length > 1) {
    decision = "escalate";
    reasonCode = "mapping_ambiguous";
    reasonDetail = "Intent mapping provided multiple selected candidates for a continue decision.";
  } else {
    edits = normalizePlannedEdits(options.plannedEdits) ?? buildDefaultPlannedEdits(intentMapping);

    if (edits.length === 0) {
      decision = "stop";
      reasonCode = "unsupported_input";
      reasonDetail = "Planner produced no safe edits from the selected intent mapping target.";
    }
  }

  const safetyChecks = buildSafetyChecks(edits, forbiddenPathPatterns, maxFileChanges, maxHunks);

  if (edits.length > 0 && decision === "stop" && reasonCode === "unsupported_input") {
    const conflictPaths = collectConflictPaths(edits);
    if (conflictPaths.length > 0) {
      decision = "escalate";
      reasonCode = "conflict_detected";
      reasonDetail = `Planner produced conflicting edits for the same path(s): ${conflictPaths.join(", ")}.`;
    } else {
      const forbiddenPaths = collectForbiddenPaths(edits, forbiddenPathPatterns);
      if (forbiddenPaths.length > 0) {
        decision = "stop";
        reasonCode = "forbidden_path";
        reasonDetail = `Plan targets forbidden path(s): ${forbiddenPaths.join(", ")}.`;
      } else {
        const exceededBounds: string[] = [];
        if (safetyChecks.max_file_changes.observed > safetyChecks.max_file_changes.limit) {
          exceededBounds.push(
            `max_file_changes ${String(safetyChecks.max_file_changes.observed)}/${String(safetyChecks.max_file_changes.limit)}`
          );
        }
        if (safetyChecks.max_hunks.observed > safetyChecks.max_hunks.limit) {
          exceededBounds.push(
            `max_hunks ${String(safetyChecks.max_hunks.observed)}/${String(safetyChecks.max_hunks.limit)}`
          );
        }

        if (exceededBounds.length > 0) {
          decision = "escalate";
          reasonCode = "change_bound_exceeded";
          reasonDetail = `Plan exceeds conservative safety bounds: ${exceededBounds.join("; ")}.`;
        } else {
          decision = "continue";
          reasonCode = "ok";
          reasonDetail = "Plan is within conservative safety bounds";
        }
      }
    }
  }

  const payload: SafeDiffPlanArtifactV1["payload"] = {
    edits,
    safety_checks: safetyChecks,
    decision,
    reason_code: reasonCode,
    reason_detail: reasonDetail
  };

  const artifactDigest = buildArtifactDigest({
    inputRef: intentMapping.inputRef,
    trace,
    payload
  });

  return {
    artifact_type: SAFE_DIFF_PLAN_ARTIFACT_TYPE,
    schema_version: SAFE_DIFF_PLAN_SCHEMA_VERSION,
    artifact_id: `dplan_${artifactDigest.slice(0, 12)}`,
    run_id: resolveRunId(intentMapping.runId, options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs: [intentMapping.inputRef],
    trace,
    payload
  };
}
