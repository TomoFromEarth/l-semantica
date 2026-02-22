import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  PATCH_RUN_ARTIFACT_TYPE,
  PATCH_RUN_SCHEMA_VERSION,
  PatchRunError,
  createIntentMappingArtifact,
  createPatchRunArtifact,
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
  const root = mkdtempSync(join(tmpdir(), "l-semantica-patch-run-"));

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
    runIdFactory: () => "run-m2-issue53-001",
    now: () => new Date("2026-02-22T15:00:00.000Z"),
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
    now: () => new Date("2026-02-22T15:00:05.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

function createSafeDiffPlan(
  repoRoot: string,
  intent: string,
  options: {
    minConfidence?: number;
    plannedEdits?: Array<{ path: string; operation?: "create" | "modify" | "delete"; justification?: string }>;
  } = {}
) {
  const intentMapping = createIntentMapping(repoRoot, intent, {
    ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {})
  });

  return createSafeDiffPlanArtifact({
    intentMapping,
    ...(options.plannedEdits ? { plannedEdits: options.plannedEdits } : {}),
    now: () => new Date("2026-02-22T15:00:10.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

function passingVerificationResults() {
  return [
    { check: "lint", status: "pass" as const, evidence_ref: "evidence://lint.log" },
    { check: "typecheck", status: "pass" as const, evidence_ref: "evidence://typecheck.log" },
    { check: "test", status: "pass" as const, evidence_ref: "evidence://test.log" }
  ];
}

test("createPatchRunArtifact emits deterministic patch output and pass-gated continuation", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: passingVerificationResults(),
      now: () => new Date("2026-02-22T15:00:20.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.artifact_type, PATCH_RUN_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, PATCH_RUN_SCHEMA_VERSION);
    assert.equal(artifact.run_id, safeDiffPlan.run_id);
    assert.equal(artifact.produced_at_utc, "2026-02-22T15:00:20.000Z");
    assert.equal(artifact.tool_version, "l-semantica@0.1.0-dev");
    assert.deepEqual(artifact.inputs, [
      {
        artifact_id: safeDiffPlan.artifact_id,
        artifact_type: safeDiffPlan.artifact_type,
        schema_version: safeDiffPlan.schema_version
      }
    ]);
    assert.equal(artifact.trace.patch_materialization, "deterministic_text_patch_v1");
    assert.equal(artifact.payload.patch.format, "unified_diff");
    assert.equal(artifact.payload.patch.file_count, 1);
    assert.equal(artifact.payload.patch.hunk_count, 1);
    assert.equal(
      artifact.payload.patch.content.includes(
        "diff --git a/flows/repo-maintenance.ls b/flows/repo-maintenance.ls"
      ),
      true
    );
    assert.equal(artifact.payload.patch_digest.startsWith("sha256:"), true);
    assert.deepEqual(artifact.payload.verification.required_checks, ["lint", "typecheck", "test"]);
    assert.equal(artifact.payload.verification.checks_complete, true);
    assert.equal(artifact.payload.verification.evidence_complete, true);
    assert.equal(artifact.payload.verification.all_required_passed, true);
    assert.deepEqual(artifact.payload.verification.missing_required_checks, []);
    assert.deepEqual(artifact.payload.verification.incomplete_checks, []);
    assert.deepEqual(artifact.payload.verification.failing_checks, []);
    assert.equal(artifact.payload.decision, "continue");
    assert.equal(artifact.payload.reason_code, "ok");
    assert.equal(artifact.payload.reason_detail, "All required checks passed with complete evidence");
    assert.equal(artifact.artifact_id.startsWith("patch_"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact is structurally deterministic for unchanged inputs and hooks", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const first = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: passingVerificationResults(),
      now: () => new Date("2026-02-22T15:00:21.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });
    const second = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: passingVerificationResults(),
      now: () => new Date("2026-02-22T15:00:21.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(second, first);
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact propagates upstream safe diff plan blocks without materializing a patch", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs",
      {
        plannedEdits: [
          {
            path: ".env.local",
            operation: "modify",
            justification: "unsafe test edit"
          }
        ]
      }
    );
    assert.equal(safeDiffPlan.payload.decision, "stop");
    assert.equal(safeDiffPlan.payload.reason_code, "forbidden_path");

    const artifact = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: passingVerificationResults(),
      now: () => new Date("2026-02-22T15:00:22.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "forbidden_path");
    assert.equal(artifact.payload.patch.content, "");
    assert.equal(artifact.payload.patch.file_count, 0);
    assert.equal(artifact.payload.patch.hunk_count, 0);
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact stops continuation when required checks fail", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: [
        { check: "lint", status: "pass", evidence_ref: "evidence://lint.log" },
        { check: "typecheck", status: "fail", evidence_ref: "evidence://typecheck.log" },
        { check: "test", status: "pass", evidence_ref: "evidence://test.log" }
      ],
      now: () => new Date("2026-02-22T15:00:23.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.verification.checks_complete, true);
    assert.equal(artifact.payload.verification.evidence_complete, true);
    assert.equal(artifact.payload.verification.all_required_passed, false);
    assert.deepEqual(artifact.payload.verification.failing_checks, ["typecheck"]);
    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "verification_failed");
    assert.equal(artifact.payload.reason_detail.includes("typecheck"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact stops continuation when required verification evidence is incomplete", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: [
        { check: "lint", status: "pass", evidence_ref: "evidence://lint.log" },
        { check: "typecheck", status: "pass" }
      ],
      now: () => new Date("2026-02-22T15:00:24.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.verification.checks_complete, false);
    assert.equal(artifact.payload.verification.evidence_complete, false);
    assert.equal(artifact.payload.verification.all_required_passed, false);
    assert.deepEqual(artifact.payload.verification.missing_required_checks, ["test"]);
    assert.equal(artifact.payload.verification.incomplete_checks.includes("typecheck"), true);
    assert.equal(artifact.payload.verification.incomplete_checks.includes("test"), true);
    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "verification_incomplete");
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact escalates policy-sensitive paths even when verification passes", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs",
      {
      plannedEdits: [
        {
          path: ".github/workflows/ci.yml",
          operation: "modify",
          justification: "update CI workflow gate"
        }
      ]
      }
    );
    assert.equal(safeDiffPlan.payload.decision, "continue");

    const artifact = createPatchRunArtifact({
      safeDiffPlan,
      verificationResults: passingVerificationResults(),
      now: () => new Date("2026-02-22T15:00:25.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.verification.checks_complete, true);
    assert.equal(artifact.payload.verification.evidence_complete, true);
    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "policy_blocked");
    assert.equal(artifact.payload.reason_detail.includes(".github/workflows/ci.yml"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPatchRunArtifact validates safe diff plan input artifact shape", () => {
  assert.throws(
    () =>
      createPatchRunArtifact({
        safeDiffPlan: {} as never
      }),
    (error: unknown) =>
      error instanceof PatchRunError &&
      error.name === "PatchRunError" &&
      error.code === "INVALID_SAFE_DIFF_PLAN"
  );
});

test("createPatchRunArtifact rejects empty-string symbol_path in safe diff plan edits", () => {
  const repo = createFixtureRepo();

  try {
    const safeDiffPlan = createSafeDiffPlan(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );
    const malformed = JSON.parse(JSON.stringify(safeDiffPlan)) as typeof safeDiffPlan;
    if (!malformed.payload.edits[0]) {
      assert.fail("expected at least one planned edit");
    }
    malformed.payload.edits[0].symbol_path = "" as never;

    assert.throws(
      () =>
        createPatchRunArtifact({
          safeDiffPlan: malformed
        }),
      (error: unknown) =>
        error instanceof PatchRunError &&
        error.code === "INVALID_SAFE_DIFF_PLAN" &&
        error.message ===
          "Patch run safe diff plan payload.edits[0].symbol_path must be null or a non-empty string"
    );
  } finally {
    repo.cleanup();
  }
});
