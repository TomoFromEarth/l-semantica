import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const WORKSPACE_SNAPSHOT_ARTIFACT_TYPE = "ls.m2.workspace_snapshot";
export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS = [".git/**", "node_modules/**"] as const;
export const WORKSPACE_SNAPSHOT_TRACE_SOURCE = "local_git_worktree";
export const DEFAULT_WORKSPACE_SNAPSHOT_TOOL_VERSION = "@l-semantica/runtime@0.1.0";

const SUPPORTED_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".cjs": "JavaScript",
  ".js": "JavaScript",
  ".json": "JSON",
  ".jsx": "JavaScript",
  ".ls": "L-Semantica",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".mjs": "JavaScript",
  ".sh": "Shell",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".yaml": "YAML",
  ".yml": "YAML"
};

export type WorkspaceSnapshotErrorCode =
  | "INVALID_WORKSPACE_ROOT"
  | "INVALID_IGNORED_PATHS"
  | "WORKSPACE_ROOT_UNREADABLE"
  | "WORKSPACE_ROOT_NOT_DIRECTORY"
  | "WORKSPACE_ENTRY_UNREADABLE"
  | "GIT_METADATA_UNAVAILABLE";

export class WorkspaceSnapshotError extends Error {
  readonly code: WorkspaceSnapshotErrorCode;
  readonly workspaceRoot?: string;

  constructor(message: string, code: WorkspaceSnapshotErrorCode, workspaceRoot?: string) {
    super(message);
    this.name = "Error";
    this.code = code;
    this.workspaceRoot = workspaceRoot;
  }
}

export interface WorkspaceSnapshotArtifactInputRef {
  artifact_id: string;
  artifact_type: string;
  schema_version: string;
}

export interface WorkspaceSnapshotArtifactV1 {
  artifact_type: typeof WORKSPACE_SNAPSHOT_ARTIFACT_TYPE;
  schema_version: typeof WORKSPACE_SNAPSHOT_SCHEMA_VERSION;
  artifact_id: string;
  run_id: string;
  produced_at_utc: string;
  tool_version: string;
  inputs: WorkspaceSnapshotArtifactInputRef[];
  trace: {
    workspace_root: string;
    source: typeof WORKSPACE_SNAPSHOT_TRACE_SOURCE;
  };
  payload: {
    git: {
      head_sha: string;
      branch: string;
      is_dirty: boolean;
    };
    inventory: {
      files_scanned: number;
      files_supported: number;
      languages: string[];
    };
    filters: {
      ignored_paths: string[];
    };
    snapshot_hash: string;
  };
}

export interface CreateWorkspaceSnapshotArtifactOptions {
  workspaceRoot: string;
  ignoredPaths?: string[];
  now?: () => Date;
  runIdFactory?: () => string;
  toolVersion?: string;
}

interface ScannedFileRecord {
  path: string;
  size_bytes: number;
  language?: string;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeWorkspaceRoot(workspaceRoot: unknown): string {
  const normalizedInput = normalizeOptionalNonEmptyString(workspaceRoot);
  if (!normalizedInput) {
    throw new WorkspaceSnapshotError(
      "Workspace snapshot workspaceRoot must be a non-empty string",
      "INVALID_WORKSPACE_ROOT"
    );
  }

  try {
    const absoluteRoot = resolve(normalizedInput);
    const realRoot = realpathSync(absoluteRoot);
    const rootStats = statSync(realRoot);
    if (!rootStats.isDirectory()) {
      throw new WorkspaceSnapshotError(
        "Workspace snapshot workspaceRoot must point to a directory",
        "WORKSPACE_ROOT_NOT_DIRECTORY",
        realRoot
      );
    }

    return realRoot;
  } catch (error) {
    if (error instanceof WorkspaceSnapshotError) {
      throw error;
    }

    throw new WorkspaceSnapshotError(
      "Workspace snapshot workspaceRoot is unreadable or does not exist",
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
    throw new WorkspaceSnapshotError(
      "Workspace snapshot ignoredPaths must be an array of non-empty strings",
      "INVALID_IGNORED_PATHS"
    );
  }

  const normalized = Array.from(
    new Set(
      ignoredPaths.map((pattern) => {
        const value = normalizeOptionalNonEmptyString(pattern);
        if (!value) {
          throw new WorkspaceSnapshotError(
            "Workspace snapshot ignoredPaths must contain only non-empty strings",
            "INVALID_IGNORED_PATHS"
          );
        }
        return value.replace(/\\/g, "/");
      })
    )
  ).sort((left, right) => left.localeCompare(right));

  return normalized;
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

function detectSupportedLanguage(relativePath: string): string | undefined {
  const extension = extname(relativePath).toLowerCase();
  return SUPPORTED_LANGUAGE_BY_EXTENSION[extension];
}

function collectWorkspaceInventory(
  workspaceRoot: string,
  ignoredPaths: string[]
): { filesScanned: number; filesSupported: number; languages: string[]; fileRecords: ScannedFileRecord[] } {
  const directoriesToScan = [workspaceRoot];
  const languages = new Set<string>();
  const fileRecords: ScannedFileRecord[] = [];
  let filesScanned = 0;
  let filesSupported = 0;

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
      throw new WorkspaceSnapshotError(
        "Workspace snapshot encountered an unreadable directory entry",
        "WORKSPACE_ENTRY_UNREADABLE",
        workspaceRoot
      );
    }

    for (const entry of entries) {
      const absoluteEntryPath = join(currentDirectory, entry.name);
      const relativeEntryPath = normalizeRelativePath(
        absoluteEntryPath.slice(workspaceRoot.length + 1)
      );

      if (relativeEntryPath.length === 0 || isIgnoredRelativePath(relativeEntryPath, ignoredPaths)) {
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

      let sizeBytes = 0;
      try {
        sizeBytes = statSync(absoluteEntryPath).size;
      } catch {
        throw new WorkspaceSnapshotError(
          "Workspace snapshot encountered an unreadable file entry",
          "WORKSPACE_ENTRY_UNREADABLE",
          workspaceRoot
        );
      }

      filesScanned += 1;
      const language = detectSupportedLanguage(relativeEntryPath);
      if (language) {
        filesSupported += 1;
        languages.add(language);
      }

      fileRecords.push({
        path: relativeEntryPath,
        size_bytes: sizeBytes,
        ...(language ? { language } : {})
      });
    }
  }

  fileRecords.sort((left, right) => left.path.localeCompare(right.path));

  return {
    filesScanned,
    filesSupported,
    languages: [...languages].sort((left, right) => left.localeCompare(right)),
    fileRecords
  };
}

function runGitCommand(workspaceRoot: string, args: string[]): string {
  const result = spawnSync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8"
  });

  if (result.error) {
    throw new WorkspaceSnapshotError(
      `Failed to read git metadata (${args.join(" ")}): ${result.error.message}`,
      "GIT_METADATA_UNAVAILABLE",
      workspaceRoot
    );
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const detail = stderr.length > 0 ? `: ${stderr}` : "";
    throw new WorkspaceSnapshotError(
      `Failed to read git metadata (${args.join(" ")})${detail}`,
      "GIT_METADATA_UNAVAILABLE",
      workspaceRoot
    );
  }

  return typeof result.stdout === "string" ? result.stdout : "";
}

function resolveGitSummary(workspaceRoot: string): {
  headSha: string;
  branch: string;
  isDirty: boolean;
  statusPorcelain: string;
} {
  const headSha = normalizeOptionalNonEmptyString(runGitCommand(workspaceRoot, ["rev-parse", "HEAD"]));
  const branch = normalizeOptionalNonEmptyString(
    runGitCommand(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
  );
  const statusPorcelain = runGitCommand(workspaceRoot, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .join("\n");

  if (!headSha || !branch) {
    throw new WorkspaceSnapshotError(
      "Git metadata is missing required HEAD or branch information",
      "GIT_METADATA_UNAVAILABLE",
      workspaceRoot
    );
  }

  return {
    headSha,
    branch,
    isDirty: statusPorcelain.length > 0,
    statusPorcelain
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

function resolveRunId(runIdFactory?: () => string): string {
  if (typeof runIdFactory === "function") {
    try {
      const candidate = runIdFactory();
      const normalized = normalizeOptionalNonEmptyString(candidate);
      if (normalized) {
        return normalized;
      }
    } catch {}
  }

  return createRunIdFallback();
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

function buildSnapshotHash(params: {
  git: { headSha: string; branch: string; isDirty: boolean; statusPorcelain: string };
  inventory: { filesScanned: number; filesSupported: number; languages: string[]; fileRecords: ScannedFileRecord[] };
  ignoredPaths: string[];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        git: {
          head_sha: params.git.headSha,
          branch: params.git.branch,
          is_dirty: params.git.isDirty,
          status_porcelain: params.git.statusPorcelain
        },
        inventory: {
          files_scanned: params.inventory.filesScanned,
          files_supported: params.inventory.filesSupported,
          languages: params.inventory.languages,
          files: params.inventory.fileRecords
        },
        filters: {
          ignored_paths: params.ignoredPaths
        }
      })
    )
    .digest("hex");

  return `sha256:${digest}`;
}

function resolveToolVersion(toolVersion: unknown): string {
  return normalizeOptionalNonEmptyString(toolVersion) ?? DEFAULT_WORKSPACE_SNAPSHOT_TOOL_VERSION;
}

export function createWorkspaceSnapshotArtifact(
  options: CreateWorkspaceSnapshotArtifactOptions
): WorkspaceSnapshotArtifactV1 {
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot);
  const ignoredPaths = normalizeIgnoredPaths(options.ignoredPaths);
  const inventory = collectWorkspaceInventory(workspaceRoot, ignoredPaths);
  const git = resolveGitSummary(workspaceRoot);
  const snapshotHash = buildSnapshotHash({
    git,
    inventory,
    ignoredPaths
  });
  const snapshotDigest = snapshotHash.slice("sha256:".length);

  return {
    artifact_type: WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
    schema_version: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    artifact_id: `wsnap_${snapshotDigest.slice(0, 12)}`,
    run_id: resolveRunId(options.runIdFactory),
    produced_at_utc: resolveProducedAtUtc(options.now),
    tool_version: resolveToolVersion(options.toolVersion),
    inputs: [],
    trace: {
      workspace_root: workspaceRoot,
      source: WORKSPACE_SNAPSHOT_TRACE_SOURCE
    },
    payload: {
      git: {
        head_sha: git.headSha,
        branch: git.branch,
        is_dirty: git.isDirty
      },
      inventory: {
        files_scanned: inventory.filesScanned,
        files_supported: inventory.filesSupported,
        languages: inventory.languages
      },
      filters: {
        ignored_paths: ignoredPaths
      },
      snapshot_hash: snapshotHash
    }
  };
}

