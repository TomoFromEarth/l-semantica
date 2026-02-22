import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS,
  WORKSPACE_SNAPSHOT_ARTIFACT_TYPE,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  WORKSPACE_SNAPSHOT_TRACE_SOURCE,
  WorkspaceSnapshotError,
  createWorkspaceSnapshotArtifact
} from "../src/index.ts";

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });

  if (result.error) {
    assert.fail(`git ${args.join(" ")} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    assert.fail(
      `git ${args.join(" ")} exited ${String(result.status)}\nstdout: ${stdout}\nstderr: ${stderr}`
    );
  }

  return typeof result.stdout === "string" ? result.stdout : "";
}

function writeRepoFile(repoRoot: string, relativePath: string, contents: string): void {
  const absolutePath = join(repoRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function createFixtureRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "l-semantica-workspace-snapshot-"));

  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "L-Semantica Test"]);
  runGit(root, ["config", "user.email", "tests@example.com"]);
  runGit(root, ["branch", "-M", "main"]);

  writeRepoFile(root, ".gitignore", "node_modules/\n");
  writeRepoFile(root, "README.md", "# Fixture Repo\n");
  writeRepoFile(root, "src/index.ts", "export const meaning = 42;\n");
  writeRepoFile(root, "assets/logo.bin", "binary-ish\n");

  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "fixture: baseline"]);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("createWorkspaceSnapshotArtifact emits normalized artifact for a clean git worktree", () => {
  const repo = createFixtureRepo();

  try {
    const artifact = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-clean-001",
      now: () => new Date("2026-02-22T12:00:00.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.artifact_type, WORKSPACE_SNAPSHOT_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, WORKSPACE_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(artifact.run_id, "run-wsnap-clean-001");
    assert.equal(artifact.produced_at_utc, "2026-02-22T12:00:00.000Z");
    assert.equal(artifact.tool_version, "l-semantica@0.1.0-dev");
    assert.equal(artifact.inputs.length, 0);
    assert.equal(artifact.trace.workspace_root, realpathSync(repo.root));
    assert.equal(artifact.trace.source, WORKSPACE_SNAPSHOT_TRACE_SOURCE);
    assert.equal(artifact.payload.git.branch, "main");
    assert.equal(artifact.payload.git.is_dirty, false);
    assert.equal(artifact.payload.git.head_sha.length > 0, true);
    assert.equal(artifact.payload.inventory.files_scanned, 4);
    assert.equal(artifact.payload.inventory.files_supported, 2);
    assert.deepEqual(artifact.payload.inventory.languages, ["Markdown", "TypeScript"]);
    assert.deepEqual(artifact.payload.filters.ignored_paths, [...DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PATHS]);
    assert.equal(artifact.payload.snapshot_hash.startsWith("sha256:"), true);
    assert.equal(artifact.artifact_id.startsWith("wsnap_"), true);
  } finally {
    repo.cleanup();
  }
});

test("createWorkspaceSnapshotArtifact is structurally deterministic for unchanged repo state", () => {
  const repo = createFixtureRepo();

  try {
    const first = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-deterministic-001",
      now: () => new Date("2026-02-22T12:00:01.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    const second = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-deterministic-001",
      now: () => new Date("2026-02-22T12:00:01.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(second, first);
  } finally {
    repo.cleanup();
  }
});

test("createWorkspaceSnapshotArtifact reports dirty worktree state and filters unsupported files", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(repo.root, "src/index.ts", "export const meaning = 43;\n");
    writeRepoFile(repo.root, "notes.tmp", "scratch notes\n");
    writeRepoFile(repo.root, "node_modules/pkg/index.js", "module.exports = 1;\n");

    const artifact = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-dirty-001",
      now: () => new Date("2026-02-22T12:00:02.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.git.is_dirty, true);
    assert.equal(artifact.payload.inventory.files_scanned, 5);
    assert.equal(artifact.payload.inventory.files_supported, 2);
    assert.deepEqual(artifact.payload.inventory.languages, ["Markdown", "TypeScript"]);
    assert.equal(existsSync(join(repo.root, "node_modules/pkg/index.js")), true);
  } finally {
    repo.cleanup();
  }
});

test("createWorkspaceSnapshotArtifact snapshot_hash changes for same-size dirty content edits", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(repo.root, "src/index.ts", "export const meaning = 43;\n");
    const firstDirtySnapshot = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-dirty-hash-001",
      now: () => new Date("2026-02-22T12:00:03.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    writeRepoFile(repo.root, "src/index.ts", "export const meaning = 99;\n");
    const secondDirtySnapshot = createWorkspaceSnapshotArtifact({
      workspaceRoot: repo.root,
      runIdFactory: () => "run-wsnap-dirty-hash-002",
      now: () => new Date("2026-02-22T12:00:04.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(firstDirtySnapshot.payload.git.is_dirty, true);
    assert.equal(secondDirtySnapshot.payload.git.is_dirty, true);
    assert.notEqual(firstDirtySnapshot.payload.snapshot_hash, secondDirtySnapshot.payload.snapshot_hash);
    assert.notEqual(firstDirtySnapshot.artifact_id, secondDirtySnapshot.artifact_id);
  } finally {
    repo.cleanup();
  }
});

test("createWorkspaceSnapshotArtifact rejects malformed and unreadable workspace inputs", () => {
  assert.throws(
    () =>
      createWorkspaceSnapshotArtifact({
        workspaceRoot: "   "
      }),
    (error: unknown) =>
      error instanceof WorkspaceSnapshotError &&
      error.name === "WorkspaceSnapshotError" &&
      error.code === "INVALID_WORKSPACE_ROOT" &&
      error.message === "Workspace snapshot workspaceRoot must be a non-empty string"
  );

  assert.throws(
    () =>
      createWorkspaceSnapshotArtifact({
        workspaceRoot: join(tmpdir(), "l-semantica-workspace-snapshot-missing", "repo")
      }),
    (error: unknown) =>
      error instanceof WorkspaceSnapshotError &&
      error.code === "WORKSPACE_ROOT_UNREADABLE" &&
      error.message === "Workspace snapshot workspaceRoot is unreadable or does not exist"
  );
});
