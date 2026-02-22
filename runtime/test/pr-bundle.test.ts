import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  PR_BUNDLE_ARTIFACT_TYPE,
  PR_BUNDLE_SCHEMA_VERSION,
  PrBundleError,
  createIntentMappingArtifact,
  createPatchRunArtifact,
  createPrBundleArtifact,
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
  const root = mkdtempSync(join(tmpdir(), "l-semantica-pr-bundle-"));

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
    runIdFactory: () => "run-m2-issue54-001",
    now: () => new Date("2026-02-22T16:00:00.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

function createIntentMapping(repoRoot: string, intent: string) {
  const snapshot = createSnapshot(repoRoot);
  const intentMapping = createIntentMappingArtifact({
    workspaceSnapshot: snapshot,
    intent,
    now: () => new Date("2026-02-22T16:00:05.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });

  return { snapshot, intentMapping };
}

function createSafeDiffPlan(
  repoRoot: string,
  intent: string,
  options: {
    plannedEdits?: Array<{ path: string; operation?: "create" | "modify" | "delete"; justification?: string }>;
  } = {}
) {
  const { snapshot, intentMapping } = createIntentMapping(repoRoot, intent);
  const safeDiffPlan = createSafeDiffPlanArtifact({
    intentMapping,
    ...(options.plannedEdits ? { plannedEdits: options.plannedEdits } : {}),
    now: () => new Date("2026-02-22T16:00:10.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });

  return { snapshot, intentMapping, safeDiffPlan };
}

function passingVerificationResults() {
  return [
    { check: "lint", status: "pass" as const, evidence_ref: "evidence://lint.log" },
    { check: "typecheck", status: "pass" as const, evidence_ref: "evidence://typecheck.log" },
    { check: "test", status: "pass" as const, evidence_ref: "evidence://test.log" }
  ];
}

function createPatchRunArtifacts(
  repoRoot: string,
  intent: string,
  options: {
    plannedEdits?: Array<{ path: string; operation?: "create" | "modify" | "delete"; justification?: string }>;
    verificationResults?: Array<{ check: string; status: "pass" | "fail" | "not_run"; evidence_ref?: string }>;
  } = {}
) {
  const { snapshot, intentMapping, safeDiffPlan } = createSafeDiffPlan(repoRoot, intent, {
    ...(options.plannedEdits ? { plannedEdits: options.plannedEdits } : {})
  });

  const patchRun = createPatchRunArtifact({
    safeDiffPlan,
    verificationResults: options.verificationResults ?? passingVerificationResults(),
    now: () => new Date("2026-02-22T16:00:20.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });

  return {
    snapshot,
    intentMapping,
    safeDiffPlan,
    patchRun
  };
}

test("createPrBundleArtifact emits complete PR-equivalent bundle with rollback package and lineage trace", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );
    assert.equal(upstream.patchRun.payload.decision, "continue");

    const artifact = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      now: () => new Date("2026-02-22T16:00:30.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.artifact_type, PR_BUNDLE_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, PR_BUNDLE_SCHEMA_VERSION);
    assert.equal(artifact.run_id, upstream.patchRun.run_id);
    assert.equal(artifact.produced_at_utc, "2026-02-22T16:00:30.000Z");
    assert.equal(artifact.tool_version, "l-semantica@0.1.0-dev");
    assert.deepEqual(artifact.inputs.map((ref) => ref.artifact_id), [
      upstream.snapshot.artifact_id,
      upstream.intentMapping.artifact_id,
      upstream.safeDiffPlan.artifact_id,
      upstream.patchRun.artifact_id
    ]);
    assert.deepEqual(artifact.trace.lineage, [
      upstream.snapshot.artifact_id,
      upstream.intentMapping.artifact_id,
      upstream.safeDiffPlan.artifact_id,
      upstream.patchRun.artifact_id
    ]);
    assert.equal(artifact.trace.boundary_mode, "artifact_only");

    assert.equal(artifact.payload.summary.length > 0, true);
    assert.equal(artifact.payload.rationale.length > 0, true);
    assert.equal(artifact.payload.patch.digest, upstream.patchRun.payload.patch_digest);
    assert.equal(artifact.payload.patch.content, upstream.patchRun.payload.patch.content);
    assert.equal(artifact.payload.patch.patch_run_artifact_id, upstream.patchRun.artifact_id);
    assert.equal(artifact.payload.risk_tradeoffs.length > 0, true);
    assert.equal(artifact.payload.verification_evidence_ref, upstream.patchRun.artifact_id);
    assert.equal(artifact.payload.verification.all_required_passed, true);

    assert.equal(artifact.payload.rollback.strategy, "reverse_patch");
    assert.equal(artifact.payload.rollback.supported, true);
    assert.notEqual(artifact.payload.rollback.package_ref, null);
    assert.notEqual(artifact.payload.rollback.package, null);
    assert.equal(artifact.payload.rollback.package?.digest.startsWith("sha256:"), true);
    assert.equal(artifact.payload.rollback.package?.content.includes("diff --git"), true);
    assert.equal(artifact.payload.rollback.instructions.length > 0, true);

    assert.equal(artifact.payload.traceability.lineage_complete, true);
    assert.equal(artifact.payload.traceability.intent_summary, upstream.intentMapping.payload.intent.summary);
    assert.equal(artifact.payload.traceability.mapped_targets.length, 1);
    assert.equal(artifact.payload.traceability.diff_plan_edits.length, 1);
    assert.equal(artifact.payload.traceability.patch_run_outcome.decision, "continue");
    assert.equal(artifact.payload.traceability.patch_run_outcome.reason_code, "ok");

    assert.equal(artifact.payload.readiness.decision, "continue");
    assert.equal(artifact.payload.readiness.reason_code, "ok");
    assert.deepEqual(artifact.payload.readiness.missing_sections, []);
    assert.equal(artifact.artifact_id.startsWith("prb_"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact is structurally deterministic for unchanged inputs and hooks", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const first = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      now: () => new Date("2026-02-22T16:00:31.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });
    const second = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      now: () => new Date("2026-02-22T16:00:31.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(second, first);
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact packages policy-blocked patch runs for human review while preserving upstream outcome", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
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
    assert.equal(upstream.patchRun.payload.decision, "escalate");
    assert.equal(upstream.patchRun.payload.reason_code, "policy_blocked");

    const artifact = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      now: () => new Date("2026-02-22T16:00:32.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.traceability.patch_run_outcome.decision, "escalate");
    assert.equal(artifact.payload.traceability.patch_run_outcome.reason_code, "policy_blocked");
    assert.equal(artifact.payload.readiness.decision, "continue");
    assert.equal(artifact.payload.readiness.reason_code, "ok");
    assert.equal(
      artifact.payload.risk_tradeoffs.some((item) => item.includes("policy-sensitive")),
      true
    );
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact stops when required lineage and rollback sections are missing", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      now: () => new Date("2026-02-22T16:00:33.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.traceability.lineage_complete, false);
    assert.equal(artifact.payload.rollback.supported, false);
    assert.equal(artifact.payload.readiness.decision, "stop");
    assert.equal(artifact.payload.readiness.reason_code, "rollback_unavailable");
    assert.equal(artifact.payload.readiness.missing_sections.includes("lineage_trace_complete"), true);
    assert.equal(artifact.payload.readiness.missing_sections.includes("rollback_package"), true);
    assert.equal(artifact.payload.readiness.missing_sections.includes("rollback_instructions"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact stops when upstream patch-run verification failed", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
      repo.root,
      "Update capability read_docs description to mention local RFCs",
      {
        verificationResults: [
          { check: "lint", status: "pass", evidence_ref: "evidence://lint.log" },
          { check: "typecheck", status: "fail", evidence_ref: "evidence://typecheck.log" },
          { check: "test", status: "pass", evidence_ref: "evidence://test.log" }
        ]
      }
    );
    assert.equal(upstream.patchRun.payload.decision, "stop");
    assert.equal(upstream.patchRun.payload.reason_code, "verification_failed");

    const artifact = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      now: () => new Date("2026-02-22T16:00:34.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.verification.all_required_passed, false);
    assert.equal(artifact.payload.readiness.decision, "stop");
    assert.equal(artifact.payload.readiness.reason_code, "verification_failed");
    assert.equal(artifact.payload.readiness.missing_sections.includes("verification_results"), true);
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact stops when verification evidence link is missing", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPatchRunArtifacts(
      repo.root,
      "Update capability read_docs description to mention local RFCs"
    );

    const artifact = createPrBundleArtifact({
      patchRun: upstream.patchRun,
      lineage: {
        workspaceSnapshot: upstream.snapshot,
        intentMapping: upstream.intentMapping,
        safeDiffPlan: upstream.safeDiffPlan
      },
      verificationEvidenceRef: null,
      now: () => new Date("2026-02-22T16:00:35.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.readiness.decision, "stop");
    assert.equal(artifact.payload.readiness.reason_code, "bundle_incomplete");
    assert.equal(artifact.payload.readiness.missing_sections.includes("verification_link"), true);
    assert.equal(artifact.payload.verification_evidence_ref, null);
  } finally {
    repo.cleanup();
  }
});

test("createPrBundleArtifact validates patch run input artifact shape", () => {
  assert.throws(
    () =>
      createPrBundleArtifact({
        patchRun: {} as never
      }),
    (error: unknown) =>
      error instanceof PrBundleError &&
      error.name === "PrBundleError" &&
      error.code === "INVALID_PATCH_RUN"
  );
});
