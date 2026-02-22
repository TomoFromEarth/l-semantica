import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

import {
  parseLsDocument,
  type SourceRange
} from "../../compiler/src/index.ts";
import {
  DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS,
  WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  type WorkspaceSnapshotArtifactV1
} from "./workspace-snapshot.ts";

export const INTENT_MAPPING_ARTIFACT_TYPE = "ls.m2.intent_mapping";
export const INTENT_MAPPING_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_INTENT_MAPPING_TOOL_VERSION = "@l-semantica/runtime@0.1.0";
export const DEFAULT_INTENT_MAPPING_INTENT_SOURCE = "user_prompt";
export const DEFAULT_INTENT_MAPPING_MIN_CONFIDENCE = 0.75;
export const DEFAULT_INTENT_MAPPING_AMBIGUITY_GAP = 0.05;
export const DEFAULT_INTENT_MAPPING_MAX_ALTERNATIVES = 5;
export const INTENT_MAPPING_EXTRACTION_METHODS = ["ast_symbol_lookup", "text_match"] as const;
export const INTENT_MAPPING_DECISIONS = ["continue", "escalate", "stop"] as const;
export const INTENT_MAPPING_REASON_CODES = [
  "ok",
  "unsupported_input",
  "mapping_ambiguous",
  "mapping_low_confidence"
] as const;

const TEXT_MATCHABLE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".ls",
  ".md",
  ".mdx",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

const MAX_TEXT_SCAN_BYTES = 256_000;

export type IntentMappingExtractionMethod = (typeof INTENT_MAPPING_EXTRACTION_METHODS)[number];
export type IntentMappingDecision = (typeof INTENT_MAPPING_DECISIONS)[number];
export type IntentMappingReasonCode = (typeof INTENT_MAPPING_REASON_CODES)[number];

export type IntentMappingErrorCode =
  | "INVALID_INTENT"
  | "INVALID_INTENT_SOURCE"
  | "INVALID_WORKSPACE_SNAPSHOT"
  | "INVALID_OPTIONS"
  | "WORKSPACE_ROOT_UNREADABLE"
  | "WORKSPACE_ROOT_NOT_DIRECTORY"
  | "WORKSPACE_ENTRY_UNREADABLE";

export class IntentMappingError extends Error {
  readonly code: IntentMappingErrorCode;
  readonly workspaceRoot?: string;

  constructor(message: string, code: IntentMappingErrorCode, workspaceRoot?: string) {
    super(message);
    this.name = "IntentMappingError";
    this.code = code;
    this.workspaceRoot = workspaceRoot;
  }
}

export interface IntentMappingArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface IntentMappingCandidateRange {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
}

export interface IntentMappingCandidate {
  target_id: string;
  path: string;
  symbol_path: string | null;
  confidence: number;
  rationale: string;
  provenance: {
    source_path: string;
    method: IntentMappingExtractionMethod;
    range?: IntentMappingCandidateRange;
  };
}

export interface IntentMappingArtifactV1 {
  artifact_type: typeof INTENT_MAPPING_ARTIFACT_TYPE;
  schema_version: typeof INTENT_MAPPING_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: IntentMappingArtifactInputRef[];
  trace: {
    intent_source: string;
    extraction_methods: IntentMappingExtractionMethod[];
  };
  payload: {
    intent: {
      summary: string;
    };
    candidates: IntentMappingCandidate[];
    alternatives: IntentMappingCandidate[];
    decision: IntentMappingDecision;
    reason_code: IntentMappingReasonCode;
    reason_detail: string;
  };
}

export interface CreateIntentMappingArtifactOptions {
  workspaceSnapshot: WorkspaceSnapshotArtifactV1;
  intent: string;
  intentSource?: string;
  minConfidence?: number;
  ambiguityGap?: number;
  maxAlternatives?: number;
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface NormalizedWorkspaceSnapshotInput {
  inputRef: IntentMappingArtifactInputRef;
  runId: string;
  workspaceRoot: string;
  ignoredPaths: string[];
}

interface CandidateBuildInput {
  intentSummary: string;
  intentNormalized: string;
  intentTokens: string[];
  path: string;
  symbolPath: string | null;
  symbolKind: "goal" | "capability" | "check" | "file";
  symbolName?: string;
  targetTexts: string[];
  method: IntentMappingExtractionMethod;
  range?: IntentMappingCandidateRange;
}

interface ScoredCandidateCollection {
  candidates: IntentMappingCandidate[];
  methodsUsed: Set<IntentMappingExtractionMethod>;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIntent(value: unknown): string {
  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new IntentMappingError(
      "Intent mapping requires a non-empty intent string",
      "INVALID_INTENT"
    );
  }

  return normalized;
}

function normalizeIntentSource(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_INTENT_MAPPING_INTENT_SOURCE;
  }

  const normalized = normalizeOptionalNonEmptyString(value);
  if (!normalized) {
    throw new IntentMappingError(
      "Intent mapping intentSource must be a non-empty string when provided",
      "INVALID_INTENT_SOURCE"
    );
  }

  return normalized;
}

function normalizeProbabilityOption(
  value: unknown,
  fallback: number,
  optionName: "minConfidence" | "ambiguityGap"
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new IntentMappingError(
      `Intent mapping ${optionName} must be a number between 0 and 1`,
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeMaxAlternatives(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_INTENT_MAPPING_MAX_ALTERNATIVES;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 50
  ) {
    throw new IntentMappingError(
      "Intent mapping maxAlternatives must be an integer between 0 and 50",
      "INVALID_OPTIONS"
    );
  }

  return value;
}

function normalizeWorkspaceRoot(workspaceRoot: unknown): string {
  const normalizedInput = normalizeOptionalNonEmptyString(workspaceRoot);
  if (!normalizedInput) {
    throw new IntentMappingError(
      "Intent mapping workspace snapshot must include a non-empty trace.workspace_root",
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  try {
    const absoluteRoot = resolve(normalizedInput);
    const realRoot = realpathSync(absoluteRoot);
    const rootStats = statSync(realRoot);
    if (!rootStats.isDirectory()) {
      throw new IntentMappingError(
        "Intent mapping workspace root must point to a directory",
        "WORKSPACE_ROOT_NOT_DIRECTORY",
        realRoot
      );
    }

    return realRoot;
  } catch (error) {
    if (error instanceof IntentMappingError) {
      throw error;
    }

    throw new IntentMappingError(
      "Intent mapping workspace root is unreadable or does not exist",
      "WORKSPACE_ROOT_UNREADABLE",
      normalizeOptionalNonEmptyString(workspaceRoot)
    );
  }
}

function normalizeIgnoredPaths(ignoredPaths: unknown): string[] {
  if (ignoredPaths === undefined) {
    return [...DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS];
  }

  if (!Array.isArray(ignoredPaths)) {
    throw new IntentMappingError(
      "Intent mapping workspace snapshot payload.filters.ignored_paths must be an array of strings",
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  return Array.from(
    new Set(
      ignoredPaths.map((pattern) => {
        const normalized = normalizeOptionalNonEmptyString(pattern);
        if (!normalized) {
          throw new IntentMappingError(
            "Intent mapping workspace snapshot payload.filters.ignored_paths must contain non-empty strings",
            "INVALID_WORKSPACE_SNAPSHOT"
          );
        }

        return normalized.replace(/\\/g, "/");
      })
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeWorkspaceSnapshotArtifact(input: unknown): NormalizedWorkspaceSnapshotInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new IntentMappingError(
      "Intent mapping requires a workspace snapshot artifact object",
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  const snapshot = input as Partial<WorkspaceSnapshotArtifactV1>;
  if (snapshot.artifact_type !== WORKSPACE_SNAPSHOT_ARTIFACT_TYPE) {
    throw new IntentMappingError(
      `Intent mapping requires ${WORKSPACE_SNAPSHOT_ARTIFACT_TYPE} input`,
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  if (snapshot.schema_version !== WORKSPACE_SNAPSHOT_SCHEMA_VERSION) {
    throw new IntentMappingError(
      `Intent mapping requires ${WORKSPACE_SNAPSHOT_ARTIFACT_TYPE}@${WORKSPACE_SNAPSHOT_SCHEMA_VERSION}`,
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  const artifactId = normalizeOptionalNonEmptyString(snapshot.artifact_id);
  const runId = normalizeOptionalNonEmptyString(snapshot.run_id);
  if (!artifactId || !runId) {
    throw new IntentMappingError(
      "Intent mapping workspace snapshot is missing required envelope fields",
      "INVALID_WORKSPACE_SNAPSHOT"
    );
  }

  const trace = snapshot.trace as { workspace_root?: unknown } | undefined;
  const payload = snapshot.payload as
    | { filters?: { ignored_paths?: unknown } }
    | undefined;

  const workspaceRoot = normalizeWorkspaceRoot(trace?.workspace_root);
  const ignoredPaths = normalizeIgnoredPaths(payload?.filters?.ignored_paths);

  return {
    inputRef: {
      artifact_id: artifactId,
      artifact_type: snapshot.artifact_type,
      schema_version: snapshot.schema_version
    },
    runId,
    workspaceRoot,
    ignoredPaths
  };
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isIgnoredRelativePath(relativePath: string, ignoredPaths: string[]): boolean {
  for (const pattern of ignoredPaths) {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) {
        return true;
      }
      continue;
    }

    if (relativePath === pattern) {
      return true;
    }
  }

  return false;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForSearch(value: string): string[] {
  const normalized = normalizeForSearch(value);
  const matches = normalized.match(/[a-z0-9]+/g) ?? [];
  const unique = new Set<string>();

  for (const token of matches) {
    if (token.length === 0) {
      continue;
    }

    if (STOP_WORDS.has(token)) {
      continue;
    }

    unique.add(token);
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
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
  return normalizeOptionalNonEmptyString(toolVersion) ?? DEFAULT_INTENT_MAPPING_TOOL_VERSION;
}

function toCandidateRange(range: SourceRange): IntentMappingCandidateRange {
  return {
    start_line: range.start.line,
    start_column: range.start.column,
    end_line: range.end.line,
    end_column: range.end.column
  };
}

function findBestMatchingLineRange(
  source: string,
  intentTokens: string[],
  intentNormalized: string
): IntentMappingCandidateRange | undefined {
  const lines = source.split(/\r?\n/);
  let bestLine = -1;
  let bestScore = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineTokens = tokenizeForSearch(line);
    let shared = 0;
    for (const token of intentTokens) {
      if (lineTokens.includes(token)) {
        shared += 1;
      }
    }

    const normalizedLine = normalizeForSearch(line);
    if (intentNormalized.length > 0 && normalizedLine.includes(intentNormalized)) {
      shared += intentTokens.length > 0 ? intentTokens.length : 1;
    }

    if (shared > bestScore) {
      bestScore = shared;
      bestLine = index;
    }
  }

  if (bestLine < 0 || bestScore <= 0) {
    return undefined;
  }

  const lineValue = lines[bestLine] ?? "";
  return {
    start_line: bestLine + 1,
    start_column: 1,
    end_line: bestLine + 1,
    end_column: Math.max(1, lineValue.length + 1)
  };
}

function scoreCandidate(input: CandidateBuildInput): { confidence: number; rationale: string } | undefined {
  const intentTokenSet = new Set(input.intentTokens);
  const targetTokens = tokenizeForSearch([input.path, ...input.targetTexts].join(" "));
  const targetTokenSet = new Set(targetTokens);

  let sharedCount = 0;
  for (const token of intentTokenSet) {
    if (targetTokenSet.has(token)) {
      sharedCount += 1;
    }
  }

  const tokenOverlapRatio = intentTokenSet.size > 0 ? sharedCount / intentTokenSet.size : 0;
  const targetCoverageRatio = targetTokenSet.size > 0 ? sharedCount / targetTokenSet.size : 0;

  const targetNormalized = normalizeForSearch([input.path, ...input.targetTexts].join(" "));
  const exactPhraseHit =
    input.intentNormalized.length >= 4 &&
    targetNormalized.length > 0 &&
    (targetNormalized.includes(input.intentNormalized) || input.intentNormalized.includes(targetNormalized));

  const symbolNameNormalized = input.symbolName ? normalizeForSearch(input.symbolName) : "";
  const exactSymbolHit =
    symbolNameNormalized.length > 0 && input.intentNormalized.includes(symbolNameNormalized);

  const pathBaseNormalized = normalizeForSearch(basename(input.path));
  const pathBaseHit =
    pathBaseNormalized.length > 0 &&
    (input.intentNormalized.includes(pathBaseNormalized) ||
      pathBaseNormalized.includes(input.intentNormalized));

  if (sharedCount === 0 && !exactPhraseHit && !exactSymbolHit && !pathBaseHit) {
    return undefined;
  }

  let score = input.method === "ast_symbol_lookup" ? 0.38 : 0.18;
  score += tokenOverlapRatio * 0.4;
  score += targetCoverageRatio * 0.08;

  if (exactPhraseHit) {
    score += input.method === "ast_symbol_lookup" ? 0.1 : 0.12;
  }

  if (exactSymbolHit) {
    score += 0.24;
  }

  if (
    input.method === "ast_symbol_lookup" &&
    input.symbolKind !== "file" &&
    input.intentNormalized.includes(input.symbolKind)
  ) {
    score += 0.05;
  }

  if (pathBaseHit) {
    score += 0.05;
  }

  const confidence = roundConfidence(Math.min(0.99, Math.max(0.01, score)));
  const rationaleParts = [
    input.method === "ast_symbol_lookup" ? "AST symbol lookup" : "Text match",
    `token overlap ${sharedCount}/${String(Math.max(1, intentTokenSet.size))}`
  ];

  if (exactSymbolHit) {
    rationaleParts.push("exact symbol-name hit");
  }

  if (exactPhraseHit) {
    rationaleParts.push("exact phrase/path substring hit");
  }

  return {
    confidence,
    rationale: `${rationaleParts.join("; ")}.`
  };
}

function createTargetId(path: string, symbolPath: string | null): string {
  const raw = `${path}#${symbolPath ?? "file"}`;
  const readable = raw
    .replace(/[^A-Za-z0-9._/#+:-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 12);

  return `${readable.length > 0 ? readable : "target"}_${digest}`;
}

function buildCandidate(input: CandidateBuildInput): IntentMappingCandidate | undefined {
  const scored = scoreCandidate(input);
  if (!scored) {
    return undefined;
  }

  return {
    target_id: createTargetId(input.path, input.symbolPath),
    path: input.path,
    symbol_path: input.symbolPath,
    confidence: scored.confidence,
    rationale: scored.rationale,
    provenance: {
      source_path: input.path,
      method: input.method,
      ...(input.range ? { range: input.range } : {})
    }
  };
}

function buildAstNodeCandidate(
  params: Omit<
    CandidateBuildInput,
    "symbolKind" | "symbolName" | "symbolPath" | "targetTexts" | "method" | "range"
  > & {
    symbolKind: "goal" | "capability" | "check";
    symbolName?: string;
    descriptionText?: string;
    range: SourceRange;
  }
): IntentMappingCandidate | undefined {
  const label =
    params.symbolKind === "goal"
      ? "goal"
      : `${params.symbolKind}:${params.symbolName ?? "unknown"}`;

  const targetTexts =
    params.symbolKind === "goal"
      ? [params.symbolName ?? ""]
      : [params.symbolName ?? "", params.descriptionText ?? ""];

  return buildCandidate({
    intentSummary: params.intentSummary,
    intentNormalized: params.intentNormalized,
    intentTokens: params.intentTokens,
    path: params.path,
    symbolPath: label,
    symbolKind: params.symbolKind,
    symbolName: params.symbolName ?? label,
    targetTexts,
    method: "ast_symbol_lookup",
    range: toCandidateRange(params.range)
  });
}

function collectAstCandidatesFromLsFile(params: {
  path: string;
  source: string;
  intentSummary: string;
  intentNormalized: string;
  intentTokens: string[];
}): IntentMappingCandidate[] {
  const parsed = parseLsDocument(params.source);
  if (!parsed.ast) {
    return [];
  }

  const document = parsed.ast;
  const candidates: IntentMappingCandidate[] = [];

  const goalCandidate = buildAstNodeCandidate({
    intentSummary: params.intentSummary,
    intentNormalized: params.intentNormalized,
    intentTokens: params.intentTokens,
    path: params.path,
    symbolKind: "goal",
    symbolName: document.goal.value,
    range: document.goal.range
  });
  if (goalCandidate) {
    candidates.push(goalCandidate);
  }

  for (const capability of document.capabilities) {
    const candidate = buildAstNodeCandidate({
      intentSummary: params.intentSummary,
      intentNormalized: params.intentNormalized,
      intentTokens: params.intentTokens,
      path: params.path,
      symbolKind: "capability",
      symbolName: capability.name,
      descriptionText: capability.description,
      range: capability.range
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const check of document.checks) {
    const candidate = buildAstNodeCandidate({
      intentSummary: params.intentSummary,
      intentNormalized: params.intentNormalized,
      intentTokens: params.intentTokens,
      path: params.path,
      symbolKind: "check",
      symbolName: check.name,
      descriptionText: check.description,
      range: check.range
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function buildTextMatchCandidate(params: {
  path: string;
  source: string;
  intentSummary: string;
  intentNormalized: string;
  intentTokens: string[];
}): IntentMappingCandidate | undefined {
  const range = findBestMatchingLineRange(params.source, params.intentTokens, params.intentNormalized);
  return buildCandidate({
    intentSummary: params.intentSummary,
    intentNormalized: params.intentNormalized,
    intentTokens: params.intentTokens,
    path: params.path,
    symbolPath: null,
    symbolKind: "file",
    targetTexts: [params.source.slice(0, MAX_TEXT_SCAN_BYTES)],
    method: "text_match",
    range
  });
}

function readTextFile(filePath: string, workspaceRoot: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    throw new IntentMappingError(
      "Intent mapping encountered an unreadable file entry",
      "WORKSPACE_ENTRY_UNREADABLE",
      workspaceRoot
    );
  }
}

function compareCandidates(left: IntentMappingCandidate, right: IntentMappingCandidate): number {
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  if (left.provenance.method !== right.provenance.method) {
    return left.provenance.method === "ast_symbol_lookup" ? -1 : 1;
  }

  if (left.path !== right.path) {
    return left.path.localeCompare(right.path);
  }

  return (left.symbol_path ?? "").localeCompare(right.symbol_path ?? "");
}

function collectIntentMappingCandidates(params: {
  workspaceRoot: string;
  ignoredPaths: string[];
  intentSummary: string;
  intentNormalized: string;
  intentTokens: string[];
}): ScoredCandidateCollection {
  const directoriesToScan = [params.workspaceRoot];
  const candidates: IntentMappingCandidate[] = [];
  const methodsUsed = new Set<IntentMappingExtractionMethod>();

  while (directoriesToScan.length > 0) {
    const currentDirectory = directoriesToScan.pop();
    if (!currentDirectory) {
      break;
    }

    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(currentDirectory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    } catch {
      throw new IntentMappingError(
        "Intent mapping encountered an unreadable directory entry",
        "WORKSPACE_ENTRY_UNREADABLE",
        params.workspaceRoot
      );
    }

    for (const entry of entries) {
      const absoluteEntryPath = join(currentDirectory, entry.name);
      const relativeEntryPath = normalizeRelativePath(relative(params.workspaceRoot, absoluteEntryPath));

      if (relativeEntryPath.length === 0 || isIgnoredRelativePath(relativeEntryPath, params.ignoredPaths)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        directoriesToScan.push(absoluteEntryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let fileSize = 0;
      try {
        fileSize = statSync(absoluteEntryPath).size;
      } catch {
        throw new IntentMappingError(
          "Intent mapping encountered an unreadable file entry",
          "WORKSPACE_ENTRY_UNREADABLE",
          params.workspaceRoot
        );
      }

      const extension = extname(relativeEntryPath).toLowerCase();
      if (!TEXT_MATCHABLE_EXTENSIONS.has(extension) || fileSize > MAX_TEXT_SCAN_BYTES) {
        continue;
      }

      const source = readTextFile(absoluteEntryPath, params.workspaceRoot);
      if (extension === ".ls") {
        const astCandidates = collectAstCandidatesFromLsFile({
          path: relativeEntryPath,
          source,
          intentSummary: params.intentSummary,
          intentNormalized: params.intentNormalized,
          intentTokens: params.intentTokens
        });

        if (astCandidates.length > 0) {
          methodsUsed.add("ast_symbol_lookup");
          candidates.push(...astCandidates);
          continue;
        }
      }

      const textCandidate = buildTextMatchCandidate({
        path: relativeEntryPath,
        source,
        intentSummary: params.intentSummary,
        intentNormalized: params.intentNormalized,
        intentTokens: params.intentTokens
      });
      if (textCandidate) {
        methodsUsed.add("text_match");
        candidates.push(textCandidate);
      }
    }
  }

  candidates.sort(compareCandidates);

  return {
    candidates,
    methodsUsed
  };
}

function resolveDecisionAndSelections(params: {
  allCandidates: IntentMappingCandidate[];
  minConfidence: number;
  ambiguityGap: number;
  maxAlternatives: number;
}): Pick<IntentMappingArtifactV1["payload"], "candidates" | "alternatives" | "decision" | "reason_code" | "reason_detail"> {
  const viable = params.allCandidates;
  if (viable.length === 0) {
    return {
      candidates: [],
      alternatives: [],
      decision: "stop",
      reason_code: "unsupported_input",
      reason_detail: "No supported repository targets matched the requested intent."
    };
  }

  const topCandidate = viable[0];
  if (!topCandidate) {
    return {
      candidates: [],
      alternatives: [],
      decision: "stop",
      reason_code: "unsupported_input",
      reason_detail: "No supported repository targets matched the requested intent."
    };
  }

  if (topCandidate.confidence < params.minConfidence) {
    return {
      candidates: [topCandidate],
      alternatives: viable.slice(1, 1 + params.maxAlternatives),
      decision: "escalate",
      reason_code: "mapping_low_confidence",
      reason_detail: `Top mapping candidate scored ${topCandidate.confidence.toFixed(4)} below minimum confidence ${params.minConfidence.toFixed(4)}.`
    };
  }

  const ambiguousCandidates = viable.filter(
    (candidate) =>
      candidate.confidence >= params.minConfidence &&
      topCandidate.confidence - candidate.confidence <= params.ambiguityGap
  );

  if (ambiguousCandidates.length > 1) {
    const ambiguousKeys = ambiguousCandidates
      .map((candidate) => `${candidate.path}${candidate.symbol_path ? `#${candidate.symbol_path}` : ""}`)
      .join(", ");

    return {
      candidates: ambiguousCandidates,
      alternatives: viable
        .filter((candidate) => !ambiguousCandidates.includes(candidate))
        .slice(0, params.maxAlternatives),
      decision: "escalate",
      reason_code: "mapping_ambiguous",
      reason_detail: `Multiple high-confidence targets remain within ambiguity gap ${params.ambiguityGap.toFixed(4)}: ${ambiguousKeys}.`
    };
  }

  return {
    candidates: [topCandidate],
    alternatives: viable.slice(1, 1 + params.maxAlternatives),
    decision: "continue",
    reason_code: "ok",
    reason_detail: "Single high-confidence target selected"
  };
}

function buildArtifactDigest(input: {
  inputRef: IntentMappingArtifactInputRef;
  trace: IntentMappingArtifactV1["trace"];
  payload: IntentMappingArtifactV1["payload"];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        inputs: [input.inputRef],
        trace: input.trace,
        payload: input.payload
      })
    )
    .digest("hex");

  return digest;
}

export function createIntentMappingArtifact(
  options: CreateIntentMappingArtifactOptions
): IntentMappingArtifactV1 {
  if (typeof options !== "object" || options === null) {
    throw new IntentMappingError(
      "Intent mapping options must be an object",
      "INVALID_OPTIONS"
    );
  }

  const workspaceSnapshot = normalizeWorkspaceSnapshotArtifact(options.workspaceSnapshot);
  const intentSummary = normalizeIntent(options.intent);
  const intentSource = normalizeIntentSource(options.intentSource);
  const minConfidence = normalizeProbabilityOption(
    options.minConfidence,
    DEFAULT_INTENT_MAPPING_MIN_CONFIDENCE,
    "minConfidence"
  );
  const ambiguityGap = normalizeProbabilityOption(
    options.ambiguityGap,
    DEFAULT_INTENT_MAPPING_AMBIGUITY_GAP,
    "ambiguityGap"
  );
  const maxAlternatives = normalizeMaxAlternatives(options.maxAlternatives);
  const intentNormalized = normalizeForSearch(intentSummary);
  const intentTokens = tokenizeForSearch(intentSummary);

  const collected = collectIntentMappingCandidates({
    workspaceRoot: workspaceSnapshot.workspaceRoot,
    ignoredPaths: workspaceSnapshot.ignoredPaths,
    intentSummary,
    intentNormalized,
    intentTokens
  });

  const payloadDecision = resolveDecisionAndSelections({
    allCandidates: collected.candidates,
    minConfidence,
    ambiguityGap,
    maxAlternatives
  });

  const extractionMethods =
    collected.methodsUsed.size > 0
      ? [...collected.methodsUsed].sort((left, right) => left.localeCompare(right))
      : [...INTENT_MAPPING_EXTRACTION_METHODS];

  const trace: IntentMappingArtifactV1["trace"] = {
    intent_source: intentSource,
    extraction_methods: extractionMethods
  };

  const payload: IntentMappingArtifactV1["payload"] = {
    intent: {
      summary: intentSummary
    },
    candidates: payloadDecision.candidates,
    alternatives: payloadDecision.alternatives,
    decision: payloadDecision.decision,
    reason_code: payloadDecision.reason_code,
    reason_detail: payloadDecision.reason_detail
  };

  const artifactDigest = buildArtifactDigest({
    inputRef: workspaceSnapshot.inputRef,
    trace,
    payload
  });

  return {
    artifact_type: INTENT_MAPPING_ARTIFACT_TYPE,
    schema_version: INTENT_MAPPING_SCHEMA_VERSION,
    artifact_id: `imap_${artifactDigest.slice(0, 12)}`,
    run_id: resolveRunId(workspaceSnapshot.runId, options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs: [workspaceSnapshot.inputRef],
    trace,
    payload
  };
}
