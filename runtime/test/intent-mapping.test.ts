import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  INTENT_MAPPING_ARTIFACT_TYPE,
  INTENT_MAPPING_SCHEMA_VERSION,
  IntentMappingError,
  createIntentMappingArtifact,
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
  const root = mkdtempSync(join(tmpdir(), "l-semantica-intent-mapping-"));

  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "L-Semantica Test"]);
  runGit(root, ["config", "user.email", "tests@example.com"]);
  runGit(root, ["branch", "-M", "main"]);

  writeRepoFile(root, ".gitignore", "node_modules/\n");
  writeRepoFile(
    root,
    "flows/repo-maintenance.ls",
    [
      'goal "maintain repository quality"',
      'capability read_docs "read repository docs and RFCs"',
      'capability edit_code "modify runtime and compiler files safely"',
      'check run_tests "run lint typecheck and tests before commit"'
    ].join("\n") + "\n"
  );
  writeRepoFile(
    root,
    "README.md",
    [
      "# Fixture Repo",
      "",
      "This repository documents how to read docs and update runtime modules safely.",
      "Use tests before commit."
    ].join("\n") + "\n"
  );
  writeRepoFile(root, "src/index.ts", "export const fixture = true;\n");

  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "fixture: baseline"]);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function createSnapshot(repoRoot: string) {
  return createWorkspaceSnapshotArtifact({
    workspaceRoot: repoRoot,
    runIdFactory: () => "run-m2-issue51-001",
    now: () => new Date("2026-02-22T13:00:00.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

test("createIntentMappingArtifact emits AST-aware mapping with provenance and snapshot lineage", () => {
  const repo = createFixtureRepo();

  try {
    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update capability read_docs description to mention local RFCs",
      now: () => new Date("2026-02-22T13:00:05.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.artifact_type, INTENT_MAPPING_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, INTENT_MAPPING_SCHEMA_VERSION);
    assert.equal(artifact.run_id, snapshot.run_id);
    assert.equal(artifact.produced_at_utc, "2026-02-22T13:00:05.000Z");
    assert.equal(artifact.tool_version, "l-semantica@0.1.0-dev");
    assert.deepEqual(artifact.inputs, [
      {
        artifact_id: snapshot.artifact_id,
        artifact_type: snapshot.artifact_type,
        schema_version: snapshot.schema_version
      }
    ]);
    assert.equal(artifact.trace.intent_source, "user_prompt");
    assert.ok(artifact.trace.extraction_methods.includes("ast_symbol_lookup"));

    assert.equal(artifact.payload.decision, "continue");
    assert.equal(artifact.payload.reason_code, "ok");
    assert.equal(artifact.payload.candidates.length, 1);
    assert.equal(artifact.payload.candidates[0]?.path, "flows/repo-maintenance.ls");
    assert.equal(artifact.payload.candidates[0]?.symbol_path, "capability:read_docs");
    assert.equal(artifact.payload.candidates[0]?.provenance.method, "ast_symbol_lookup");
    assert.equal(artifact.payload.candidates[0]?.provenance.range?.start_line, 2);
    assert.equal(artifact.payload.candidates[0]?.confidence >= 0.75, true);
    assert.equal(artifact.artifact_id.startsWith("imap_"), true);
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact is structurally deterministic for unchanged inputs and hooks", () => {
  const repo = createFixtureRepo();

  try {
    const snapshot = createSnapshot(repo.root);
    const first = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update capability read_docs description to mention local RFCs",
      now: () => new Date("2026-02-22T13:00:06.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });
    const second = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update capability read_docs description to mention local RFCs",
      now: () => new Date("2026-02-22T13:00:06.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(second, first);
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact escalates ambiguous high-confidence mappings", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(
      repo.root,
      "flows/repo-maintenance-2.ls",
      [
        'goal "maintain repository quality"',
        'capability read_docs "read repository docs and RFCs"',
        'capability open_issue "open issue for follow-up"',
        'check run_tests "run lint typecheck and tests before commit"'
      ].join("\n") + "\n"
    );

    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update capability read_docs description",
      now: () => new Date("2026-02-22T13:00:07.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "mapping_ambiguous");
    assert.equal(artifact.payload.candidates.length >= 2, true);
    assert.equal(
      artifact.payload.candidates.every((candidate) => candidate.symbol_path === "capability:read_docs"),
      true
    );
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact escalates low-confidence mappings when threshold is not met", () => {
  const repo = createFixtureRepo();

  try {
    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update capability read_docs description to mention local RFCs",
      minConfidence: 0.995,
      now: () => new Date("2026-02-22T13:00:08.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "mapping_low_confidence");
    assert.equal(artifact.payload.candidates.length, 1);
    assert.equal(artifact.payload.candidates[0]?.symbol_path, "capability:read_docs");
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact stops unsupported inputs when no viable target matches", () => {
  const repo = createFixtureRepo();

  try {
    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "rotate elliptic hypercube qubits",
      now: () => new Date("2026-02-22T13:00:09.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "unsupported_input");
    assert.deepEqual(artifact.payload.candidates, []);
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact prefers AST symbol hits over file-level text matches to avoid false remaps", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(
      repo.root,
      "docs/notes.md",
      [
        "# Notes",
        "",
        "Update read_docs capability description in repo maintenance flow.",
        "Update read_docs capability description in repo maintenance flow."
      ].join("\n") + "\n"
    );

    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "Update read_docs capability description in repo maintenance flow",
      now: () => new Date("2026-02-22T13:00:10.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "continue");
    assert.equal(artifact.payload.reason_code, "ok");
    assert.equal(artifact.payload.candidates[0]?.path, "flows/repo-maintenance.ls");
    assert.equal(artifact.payload.candidates[0]?.provenance.method, "ast_symbol_lookup");
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact omits text-match provenance range for path-only matches", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(
      repo.root,
      "docs/quantum-sprocket-index.md",
      [
        "# Placeholder",
        "",
        "No intent tokens appear in this file body."
      ].join("\n") + "\n"
    );

    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "quantum sprocket index",
      minConfidence: 0,
      now: () => new Date("2026-02-22T13:00:11.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    const target = artifact.payload.candidates.find(
      (candidate) => candidate.path === "docs/quantum-sprocket-index.md"
    );

    assert.notEqual(target, undefined);
    assert.equal(target?.provenance.method, "text_match");
    assert.equal("range" in (target?.provenance ?? {}), false);
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact keeps target_id unique for paths that sanitize similarly", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(repo.root, "docs/review key.md", "placeholder body\n");
    writeRepoFile(repo.root, "docs/review_key.md", "placeholder body\n");

    const snapshot = createSnapshot(repo.root);
    const artifact = createIntentMappingArtifact({
      workspaceSnapshot: snapshot,
      intent: "review key",
      minConfidence: 0,
      ambiguityGap: 1,
      now: () => new Date("2026-02-22T13:00:12.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    const reviewKeyCandidates = artifact.payload.candidates.filter(
      (candidate) =>
        candidate.path === "docs/review key.md" || candidate.path === "docs/review_key.md"
    );

    assert.equal(reviewKeyCandidates.length, 2);
    assert.notEqual(reviewKeyCandidates[0]?.target_id, reviewKeyCandidates[1]?.target_id);
  } finally {
    repo.cleanup();
  }
});

test("createIntentMappingArtifact validates workspace snapshot input artifact shape", () => {
  assert.throws(
    () =>
      createIntentMappingArtifact({
        workspaceSnapshot: {} as never,
        intent: "Update read_docs"
      }),
    (error: unknown) =>
      error instanceof IntentMappingError &&
      error.name === "IntentMappingError" &&
      error.code === "INVALID_WORKSPACE_SNAPSHOT"
  );
});
