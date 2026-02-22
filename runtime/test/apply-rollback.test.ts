import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE,
  APPLY_ROLLBACK_RECORD_SCHEMA_VERSION,
  ApplyRollbackError,
  createApplyRollbackRecordArtifact,
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

function readRepoFile(repoRoot: string, relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function sha256Prefixed(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rebuildSnapshotDigest(snapshot: {
  files: Array<{
    path: string;
    exists: boolean;
    byte_length: number;
    content_sha256: string | null;
  }>;
}): string {
  return sha256Prefixed(
    JSON.stringify(
      snapshot.files.map((entry) => ({
        path: entry.path,
        exists: entry.exists,
        byte_length: entry.byte_length,
        content_sha256: entry.content_sha256
      }))
    )
  );
}

function createFixtureRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "l-semantica-apply-rollback-"));

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
  writeRepoFile(root, "docs/notes.txt", "baseline-notes\n");

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
    runIdFactory: () => "run-m2-issue56-001",
    now: () => new Date("2026-02-22T18:00:00.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

function createIntentMapping(repoRoot: string, intent: string) {
  const snapshot = createSnapshot(repoRoot);
  const intentMapping = createIntentMappingArtifact({
    workspaceSnapshot: snapshot,
    intent,
    now: () => new Date("2026-02-22T18:00:05.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });

  return { snapshot, intentMapping };
}

function createSafeDiffPlan(
  repoRoot: string,
  intent: string,
  plannedEdits: Array<{
    path: string;
    operation: "create" | "modify" | "delete";
    justification: string;
  }>
) {
  const { snapshot, intentMapping } = createIntentMapping(repoRoot, intent);
  const safeDiffPlan = createSafeDiffPlanArtifact({
    intentMapping,
    plannedEdits,
    now: () => new Date("2026-02-22T18:00:10.000Z"),
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

function createPrBundleChain(
  repoRoot: string,
  options: {
    plannedEdits?: Array<{
      path: string;
      operation: "create" | "modify" | "delete";
      justification: string;
    }>;
    rollbackSupportedOverride?: boolean;
  } = {}
) {
  const plannedEdits =
    options.plannedEdits ??
    [
      {
        path: "flows/repo-maintenance.ls",
        operation: "modify" as const,
        justification: "Update capability read_docs description to mention local RFCs"
      }
    ];

  const intent = "Update capability read_docs description to mention local RFCs";
  const { snapshot, intentMapping, safeDiffPlan } = createSafeDiffPlan(repoRoot, intent, plannedEdits);
  const patchRun = createPatchRunArtifact({
    safeDiffPlan,
    verificationResults: passingVerificationResults(),
    now: () => new Date("2026-02-22T18:00:20.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });
  assert.equal(patchRun.payload.decision, "continue");

  const prBundle = createPrBundleArtifact({
    patchRun,
    lineage: {
      workspaceSnapshot: snapshot,
      intentMapping,
      safeDiffPlan
    },
    ...(options.rollbackSupportedOverride === undefined
      ? {}
      : { rollback: { supported: options.rollbackSupportedOverride } }),
    now: () => new Date("2026-02-22T18:00:30.000Z"),
    toolVersion: "l-semantica@0.1.0-dev"
  });

  return { snapshot, intentMapping, safeDiffPlan, patchRun, prBundle };
}

function createPassingBenchmarkReport() {
  return {
    artifact_type: "ls.m2.legacy_benchmark_report",
    schema_version: "1.0.0",
    artifact_id: "bench_pass_001",
    run_id: "run_bench_001",
    produced_at_utc: "2026-02-22T17:00:00.000Z",
    tool_version: "l-semantica@0.1.0-dev",
    inputs: [],
    trace: {},
    payload: {
      m2_objective_evaluation: {
        decision: "continue",
        reason_code: "ok",
        reason_detail: "Quality floor preserved and valid gain confirmed",
        quality_floor_preserved: true,
        valid_gain: true
      }
    }
  } as const;
}

function createFailingBenchmarkReport() {
  return {
    artifact_type: "ls.m2.legacy_benchmark_report",
    schema_version: "1.0.0",
    artifact_id: "bench_fail_001",
    run_id: "run_bench_002",
    produced_at_utc: "2026-02-22T17:00:05.000Z",
    tool_version: "l-semantica@0.1.0-dev",
    inputs: [],
    trace: {},
    payload: {
      m2_objective_evaluation: {
        decision: "stop",
        reason_code: "benchmark_quality_floor_failed",
        reason_detail: "Quality floor failed in benchmark report",
        quality_floor_preserved: false,
        valid_gain: false
      }
    }
  } as const;
}

function createApplyRecord(
  repoRoot: string,
  prBundle: ReturnType<typeof createPrBundleChain>["prBundle"],
  options: {
    execute?: boolean;
    declaredCapabilities?: string[];
    approvalEvidenceRef?: string | null;
    requireBenchmarkValidGain?: boolean;
    benchmarkReport?: unknown;
    now?: () => Date;
  } = {}
) {
  return createApplyRollbackRecordArtifact({
    action: "apply",
    prBundle,
    workspaceRoot: repoRoot,
    execute: options.execute ?? true,
    declaredCapabilities: options.declaredCapabilities ?? ["workspace.apply_patch"],
    approvalEvidenceRef: options.approvalEvidenceRef ?? "approval://ticket/123",
    policyProfileRef: "policy.local-dev.v1",
    verificationContractRef: "verification.m2.v1",
    targetWorkspaceRef: "workspace://fixture",
    requireBenchmarkValidGain: options.requireBenchmarkValidGain,
    benchmarkReport: options.benchmarkReport,
    now: options.now ?? (() => new Date("2026-02-22T18:01:00.000Z")),
    toolVersion: "l-semantica@0.1.0-dev"
  });
}

test("createApplyRollbackRecordArtifact emits apply record and executes deterministic local apply under policy gates", () => {
  const repo = createFixtureRepo();

  try {
    const baselineFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    const upstream = createPrBundleChain(repo.root);

    const artifact = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true
    });

    assert.equal(artifact.artifact_type, APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE);
    assert.equal(artifact.schema_version, APPLY_ROLLBACK_RECORD_SCHEMA_VERSION);
    assert.equal(artifact.payload.action, "apply");
    assert.equal(artifact.payload.decision, "continue");
    assert.equal(artifact.payload.reason_code, "ok");
    assert.equal(artifact.payload.execution.execute_requested, true);
    assert.equal(artifact.payload.execution.executed, true);
    assert.equal(artifact.payload.verification.pr_bundle_ready, true);
    assert.equal(artifact.payload.rollback.available, true);
    assert.equal(artifact.payload.rollback.package_valid, true);
    assert.equal(artifact.payload.traceability.pr_bundle_artifact_id, upstream.prBundle.artifact_id);
    assert.equal(artifact.payload.traceability.patch_run_artifact_id, upstream.patchRun.artifact_id);
    assert.equal(artifact.payload.traceability.benchmark_gate?.benchmark_artifact_id, "bench_pass_001");
    assert.equal(artifact.trace.policy_profile_ref, "policy.local-dev.v1");
    assert.equal(artifact.trace.verification_contract_ref, "verification.m2.v1");
    assert.equal(artifact.trace.target_workspace_ref, "workspace://fixture");
    assert.equal(artifact.inputs.some((ref) => ref.artifact_id === upstream.prBundle.artifact_id), true);
    assert.equal(artifact.inputs.some((ref) => ref.artifact_id === "bench_pass_001"), true);

    const appliedFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    assert.notEqual(appliedFlow, baselineFlow);
    assert.equal(appliedFlow.includes("deterministic apply/rollback placeholder"), true);
    assert.equal(appliedFlow.includes(`pr_bundle:${upstream.prBundle.artifact_id}`), true);

    assert.equal(artifact.payload.execution.state_before.files.length, 1);
    assert.equal(artifact.payload.execution.state_after.files.length, 1);
    assert.notEqual(artifact.payload.execution.state_before.digest, artifact.payload.execution.state_after.digest);
    assert.deepEqual(artifact.payload.target_state.changed_paths, ["flows/repo-maintenance.ls"]);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact rollback restores prior state deterministically for supported local scenarios", () => {
  const repo = createFixtureRepo();

  try {
    const baselineFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    const upstream = createPrBundleChain(repo.root);
    const applyRecord = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:02:00.000Z")
    });
    assert.equal(applyRecord.payload.decision, "continue");

    const rollbackRecord = createApplyRollbackRecordArtifact({
      action: "rollback",
      prBundle: upstream.prBundle,
      previousApplyRecord: applyRecord,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.rollback_patch"],
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      now: () => new Date("2026-02-22T18:02:30.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(rollbackRecord.payload.action, "rollback");
    assert.equal(rollbackRecord.payload.decision, "continue");
    assert.equal(rollbackRecord.payload.reason_code, "ok");
    assert.equal(rollbackRecord.payload.execution.executed, true);
    assert.equal(rollbackRecord.payload.rollback.prior_apply_record_artifact_id, applyRecord.artifact_id);
    assert.equal(rollbackRecord.payload.rollback.restored_to_prior_state, true);
    assert.equal(
      rollbackRecord.payload.execution.state_after.digest,
      applyRecord.payload.execution.state_before.digest
    );
    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), baselineFlow);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact escalates undeclared capability usage and does not mutate workspace", () => {
  const repo = createFixtureRepo();

  try {
    const baselineFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    const upstream = createPrBundleChain(repo.root);

    const artifact = createApplyRecord(repo.root, upstream.prBundle, {
      declaredCapabilities: [],
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:03:00.000Z")
    });

    assert.equal(artifact.payload.decision, "escalate");
    assert.equal(artifact.payload.reason_code, "undeclared_capability");
    assert.equal(artifact.payload.execution.executed, false);
    assert.equal(artifact.payload.policy.missing_capabilities.includes("workspace.apply_patch"), true);
    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), baselineFlow);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact stops apply when PR bundle rollback support is unavailable", () => {
  const repo = createFixtureRepo();

  try {
    const baselineFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    const upstream = createPrBundleChain(repo.root, { rollbackSupportedOverride: false });

    const artifact = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:04:00.000Z")
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "rollback_unavailable");
    assert.equal(artifact.payload.execution.executed, false);
    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), baselineFlow);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact stops apply when benchmark evidence marks M2 gain invalid", () => {
  const repo = createFixtureRepo();

  try {
    const baselineFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");
    const upstream = createPrBundleChain(repo.root);

    const artifact = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createFailingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:05:00.000Z")
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "benchmark_quality_floor_failed");
    assert.equal(artifact.payload.execution.executed, false);
    assert.equal(artifact.payload.traceability.benchmark_gate?.enforced, true);
    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), baselineFlow);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact blocks root-level sensitive paths for **/id_rsa patterns", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPrBundleChain(repo.root);
    const tamperedPrBundle = cloneJson(upstream.prBundle);
    tamperedPrBundle.payload.traceability.diff_plan_edits[0].path = "id_rsa";

    const artifact = createApplyRollbackRecordArtifact({
      action: "apply",
      prBundle: tamperedPrBundle,
      workspaceRoot: repo.root,
      execute: false,
      declaredCapabilities: ["workspace.apply_patch"],
      approvalEvidenceRef: "approval://ticket/123",
      blockedPathPatterns: ["**/id_rsa"],
      escalationPathPatterns: [],
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      now: () => new Date("2026-02-22T18:05:30.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(artifact.payload.decision, "stop");
    assert.equal(artifact.payload.reason_code, "policy_blocked");
    assert.deepEqual(artifact.payload.policy.blocked_paths, ["id_rsa"]);
    assert.equal(artifact.payload.execution.executed, false);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact accepts zero-byte prior snapshots and restores empty files on rollback", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPrBundleChain(repo.root);
    const applyRecord = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:05:40.000Z")
    });
    assert.equal(applyRecord.payload.decision, "continue");

    const zeroBytePreviousRecord = cloneJson(applyRecord);
    const stateBefore = zeroBytePreviousRecord.payload.execution.state_before;
    const targetFile = stateBefore.files[0];
    assert.equal(targetFile.path, "flows/repo-maintenance.ls");
    targetFile.byte_length = 0;
    targetFile.content_base64 = "";
    targetFile.content_sha256 = sha256Prefixed(Buffer.alloc(0));
    stateBefore.digest = rebuildSnapshotDigest(stateBefore);

    const rollbackRecord = createApplyRollbackRecordArtifact({
      action: "rollback",
      prBundle: upstream.prBundle,
      previousApplyRecord: zeroBytePreviousRecord,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.rollback_patch"],
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      now: () => new Date("2026-02-22T18:05:50.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(rollbackRecord.payload.decision, "continue");
    assert.equal(rollbackRecord.payload.rollback.restored_to_prior_state, true);
    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), "");
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact rejects corrupted prior snapshot content before rollback writes", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPrBundleChain(repo.root);
    const applyRecord = createApplyRecord(repo.root, upstream.prBundle, {
      benchmarkReport: createPassingBenchmarkReport(),
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:05:55.000Z")
    });
    const appliedFlow = readRepoFile(repo.root, "flows/repo-maintenance.ls");

    const corruptedPreviousRecord = cloneJson(applyRecord);
    corruptedPreviousRecord.payload.execution.state_before.files[0].content_base64 = Buffer.from(
      "tampered-content\n",
      "utf8"
    ).toString("base64");
    // Keep byte_length/content_sha256 and snapshot digest unchanged so validation must inspect decoded content.

    assert.throws(
      () =>
        createApplyRollbackRecordArtifact({
          action: "rollback",
          prBundle: upstream.prBundle,
          previousApplyRecord: corruptedPreviousRecord,
          workspaceRoot: repo.root,
          execute: true,
          declaredCapabilities: ["workspace.rollback_patch"],
          policyProfileRef: "policy.local-dev.v1",
          verificationContractRef: "verification.m2.v1",
          targetWorkspaceRef: "workspace://fixture",
          now: () => new Date("2026-02-22T18:06:05.000Z"),
          toolVersion: "l-semantica@0.1.0-dev"
        }),
      (error) => {
        assert.equal(error instanceof ApplyRollbackError, true);
        assert.equal((error as ApplyRollbackError).code, "INVALID_PREVIOUS_RECORD");
        return true;
      }
    );

    assert.equal(readRepoFile(repo.root, "flows/repo-maintenance.ls"), appliedFlow);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact is deterministic across apply and rollback replays on restored workspace state", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPrBundleChain(repo.root);
    const benchmark = createPassingBenchmarkReport();

    const applyOne = createApplyRollbackRecordArtifact({
      action: "apply",
      prBundle: upstream.prBundle,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.apply_patch"],
      approvalEvidenceRef: "approval://ticket/123",
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      benchmarkReport: benchmark,
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:06:00.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    const rollbackOne = createApplyRollbackRecordArtifact({
      action: "rollback",
      prBundle: upstream.prBundle,
      previousApplyRecord: applyOne,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.rollback_patch"],
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      now: () => new Date("2026-02-22T18:06:30.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.equal(rollbackOne.payload.decision, "continue");

    const applyTwo = createApplyRollbackRecordArtifact({
      action: "apply",
      prBundle: upstream.prBundle,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.apply_patch"],
      approvalEvidenceRef: "approval://ticket/123",
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      benchmarkReport: benchmark,
      requireBenchmarkValidGain: true,
      now: () => new Date("2026-02-22T18:06:00.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    const rollbackTwo = createApplyRollbackRecordArtifact({
      action: "rollback",
      prBundle: upstream.prBundle,
      previousApplyRecord: applyTwo,
      workspaceRoot: repo.root,
      execute: true,
      declaredCapabilities: ["workspace.rollback_patch"],
      policyProfileRef: "policy.local-dev.v1",
      verificationContractRef: "verification.m2.v1",
      targetWorkspaceRef: "workspace://fixture",
      now: () => new Date("2026-02-22T18:06:30.000Z"),
      toolVersion: "l-semantica@0.1.0-dev"
    });

    assert.deepEqual(applyTwo, applyOne);
    assert.deepEqual(rollbackTwo, rollbackOne);
  } finally {
    repo.cleanup();
  }
});

test("createApplyRollbackRecordArtifact rejects malformed prior apply records for rollback", () => {
  const repo = createFixtureRepo();

  try {
    const upstream = createPrBundleChain(repo.root);

    assert.throws(
      () =>
        createApplyRollbackRecordArtifact({
          action: "rollback",
          prBundle: upstream.prBundle,
          previousApplyRecord: {
            artifact_type: APPLY_ROLLBACK_RECORD_ARTIFACT_TYPE,
            schema_version: APPLY_ROLLBACK_RECORD_SCHEMA_VERSION,
            artifact_id: "applyrb_bad",
            run_id: "run_bad",
            produced_at_utc: "2026-02-22T18:07:00.000Z",
            tool_version: "l-semantica@0.1.0-dev",
            inputs: [],
            trace: {
              lineage: [],
              boundary_mode: "artifact_only",
              policy_profile_ref: "policy.local-dev.v1",
              verification_contract_ref: "verification.m2.v1",
              target_workspace_ref: null
            },
            payload: {
              action: "apply",
              decision: "stop",
              reason_code: "policy_blocked",
              reason_detail: "bad",
              policy: {
                action_allowed: false,
                approval_required: true,
                approval_evidence_ref: null,
                required_capability: "workspace.apply_patch",
                declared_capabilities: [],
                missing_capabilities: ["workspace.apply_patch"],
                blocked_paths: [],
                escalation_paths: []
              },
              verification: {
                patch_run_artifact_id: upstream.patchRun.artifact_id,
                pr_bundle_ready: true,
                pr_bundle_readiness: { decision: "continue", reason_code: "ok", reason_detail: "ok" },
                patch_run_outcome: { decision: "continue", reason_code: "ok", reason_detail: "ok" },
                required_checks: ["lint"],
                results: [],
                checks_complete: true,
                evidence_complete: true,
                all_required_passed: true,
                missing_required_checks: [],
                incomplete_checks: [],
                failing_checks: []
              },
              rollback: {
                available: true,
                strategy: "reverse_patch",
                package_ref: "rollback_x",
                package_digest: upstream.prBundle.payload.rollback.package?.digest ?? null,
                package_format: "unified_diff",
                package_valid: true,
                instructions_present: true,
                prior_apply_record_artifact_id: null,
                previous_apply_restore_snapshot_available: false,
                restored_to_prior_state: false
              },
              target_state: {
                changed_paths: ["flows/repo-maintenance.ls"],
                expected_precondition_digest: null,
                observed_precondition_digest: "sha256:abc",
                preconditions_met: true,
                observed_result_digest: "sha256:def"
              },
              execution: {
                mode: "deterministic_workspace_placeholder_v1",
                execute_requested: true,
                executed: true,
                state_before: { digest: "sha256:bad", files: [] },
                state_after: { digest: "sha256:bad2", files: [] }
              },
              traceability: {
                pr_bundle_artifact_id: upstream.prBundle.artifact_id,
                patch_run_artifact_id: upstream.patchRun.artifact_id,
                benchmark_gate: null
              }
            }
          } as never,
          workspaceRoot: repo.root,
          execute: false,
          declaredCapabilities: ["workspace.rollback_patch"]
        }),
      (error) => {
        assert.equal(error instanceof ApplyRollbackError, true);
        assert.equal((error as ApplyRollbackError).code, "INVALID_PREVIOUS_RECORD");
        return true;
      }
    );
  } finally {
    repo.cleanup();
  }
});
