import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  SAFE_DIFF_PLAN_ARTIFACT_TYPE,
  SAFE_DIFF_PLAN_SCHEMA_VERSION,
  SafeDiffPlanError,
  createIntentMappingArtifact,
  createSafeDiffPlanArtifact,
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
  const root = mkdtempSync(join(tmpdir(), "l-semantica-safe-diff-plan-"));

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
  writeRepoFile(root, "README.md", "# Fixture Repo\n");

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
    runIdFactory: () => "run-m2-issue52-001",
    now: () => new Date("2026-02-22T14:00:00.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

function createIntentMapping(
  repoRoot: string,
  intent: string,
  options: { minConfidence?: number } = {}
) {
  const snapshot = createSnapshot(repoRoot);
  return createIntentMappingArtifact({
    workspaceSnapshot: snapshot,
    intent,
    ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
    now: () => new Date("2026-02-22T14:00:05.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

test("createSafeDiffPlanArtifact emits bounded safe diff plan artifact from intent mapping", () => {
  const repo = createFixtureRepo();

  try {
    const intentMapping = createIntentMapping(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createSafeDiffPlanArtifact({
      intentMapping,
      now: () => new Date("2026-02-22T14:00:10.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.artifact_type, SAFE_DIFF_PLAN_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, SAFE_DIFF_PLAN_SCHEMA_VERSION);
    assert.equal(artifact.run_id, intentMapping.run_id);
    assert.equal(artifact.produced_at_utc, "2026-02-22T14:00:10.000Z");
    assert.equal(artifact.tool_version, "l-semantica@0.1.0-dev");
    assert.deepEqual(artifact.inputs, [
      {
        artifact_id: intentMapping.artifact_id,
        artifact_type: intentMapping.artifact_type,
        schema_version: intentMapping.schema_version
      }
    ]);
    assert.equal(artifact.trace.planner_profile, "default-conservative");

    assert.equal(artifact.payload.decision, "continue");
    assert.equal(artifact.payload.reason_code, "ok");
    assert.equal(artifact.payload.edits.length, 1);
    assert.equal(artifact.payload.edits[0]?.path, "flows/repo-maintenance.ls");
    assert.equal(artifact.payload.edits[0]?.operation, "modify");
    assert.equal(artifact.payload.edits[0]?.target_id, intentMapping.payload.candidates[0]?.target_id);
    assert.equal(artifact.payload.safety_checks.max_file_changes.observed, 1);
    assert.equal(artifact.payload.safety_checks.max_hunks.observed, 1);
    assert.equal(artifact.artifact_id.startsWith("dplan_"), true);
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact is structurally deterministic for unchanged inputs and hooks", () => {
  const repo = createFixtureRepo();

  try {
    const intentMapping = createIntentMapping(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const first = createSafeDiffPlanArtifact({
      intentMapping,
      now: () => new Date("2026-02-22T14:00:11.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });
    const second = createSafeDiffPlanArtifact({
      intentMapping,
      now: () => new Date("2026-02-22T14:00:11.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(second, first);
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact propagates ambiguous mapping blocks from upstream intent mapping", () => {
  const repo = createFixtureRepo();

  try {
    writeRepoFile(
      repo.root,
      "flows/repo-maintenance-2.ls",
      [
        'goal "maintain repository quality"',
        'capability read_docs "read repository docs and RFCs"',
        'check run_tests "run lint typecheck and tests before commit"'
      ].join("\n") + "\n"
    );

    const intentMapping = createIntentMapping(repo.root, "Update capability read_docs description");
    assert.equal(intentMapping.payload.decision, "escalate");
    assert.equal(intentMapping.payload.reason_code, "mapping_ambiguous");

    const artifact = createSafeDiffPlanArtifact({
      intentMapping,
      now: () => new Date("2026-02-22T14:00:12.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "mapping_ambiguous");
    assert.deepEqual(artifact.payload.edits, []);
    assert.equal(artifact.payload.safety_checks.max_hunks.observed, 0);
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact stops forbidden-path edits with reason-coded outcome", () => {
  const repo = createFixtureRepo();

  try {
    const intentMapping = createIntentMapping(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createSafeDiffPlanArtifact({
      intentMapping,
      plannedEdits: [
        {
          path: ".env.local",
          operation: "modify",
          justification: "unsafe test edit"
        }
      ],
      now: () => new Date("2026-02-22T14:00:13.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "forbidden_path");
    assert.equal(artifact.payload.edits[0]?.path, ".env.local");
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact escalates when conservative file or hunk bounds are exceeded", () => {
  const repo = createFixtureRepo();

  try {
    const intentMapping = createIntentMapping(repo.root, "Update repository docs", {
      minConfidence: 0
    });

    const artifact = createSafeDiffPlanArtifact({
      intentMapping,
      plannedEdits: [
        { path: "docs/a.md" },
        { path: "docs/b.md" },
        { path: "docs/c.md" }
      ],
      maxFileChanges: 2,
      maxHunks: 2,
      now: () => new Date("2026-02-22T14:00:14.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "change_bound_exceeded");
    assert.equal(artifact.payload.safety_checks.max_file_changes.observed, 3);
    assert.equal(artifact.payload.safety_checks.max_hunks.observed, 3);
    assert.equal(artifact.payload.reason_detail.includes("max_file_changes"), true);
    assert.equal(artifact.payload.reason_detail.includes("max_hunks"), true);
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact escalates conflicting edits that target the same path", () => {
  const repo = createFixtureRepo();

  try {
    const intentMapping = createIntentMapping(repo.root, "Update repository docs", {
      minConfidence: 0
    });

    const artifact = createSafeDiffPlanArtifact({
      intentMapping,
      plannedEdits: [
        { path: "README.md", operation: "modify" },
        { path: "README.md", operation: "delete" }
      ],
      now: () => new Date("2026-02-22T14:00:15.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "conflict_detected");
    assert.equal(artifact.payload.reason_detail.includes("README.md"), true);
  } finally {
    repo.cleanup();
  }
});

test("createSafeDiffPlanArtifact validates intent mapping input artifact shape", () => {
  assert.throws(
    () =>
      createSafeDiffPlanArtifact({
        intentMapping: {} as never
      }),
    (error: unknown) =>
      error instanceof SafeDiffPlanError &&
      error.name === "SafeDiffPlanError" &&
      error.code === "INVALID_INTENT_MAPPING"
  );
});
