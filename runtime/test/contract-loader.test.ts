import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ContractValidationError,
  SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION,
  SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION,
  SUPPORTED_VERIFICATION_CONTRACT_SCHEMA_VERSION,
  loadRuntimeContracts
} from "../src/index.ts";

function loadJson(relativePathFromThisTest: string): unknown {
  const fileContents = readFileSync(new URL(relativePathFromThisTest, import.meta.url), "utf8");
  return JSON.parse(fileContents) as unknown;
}

function expectContractValidationError(
  operation: () => unknown,
  expectation: {
    contract: "RuntimeContracts" | "SemanticIR" | "PolicyProfile" | "VerificationContract";
    code: "INVALID_INPUT" | "VERSION_INCOMPATIBLE" | "SCHEMA_VALIDATION_FAILED";
    messageIncludes: string;
    issues?: {
      minCount?: number;
      hasKeyword?: string;
      hasInstancePath?: string;
      hasMessageIncludes?: string;
    };
  }
): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.contract, expectation.contract);
    assert.equal(error.code, expectation.code);
    assert.equal(error.message.includes(expectation.messageIncludes), true);
    if (expectation.issues?.minCount !== undefined) {
      assert.equal(error.issues.length >= expectation.issues.minCount, true);
    }
    if (expectation.issues?.hasKeyword !== undefined) {
      assert.equal(
        error.issues.some((issue) => issue.keyword === expectation.issues?.hasKeyword),
        true
      );
    }
    if (expectation.issues?.hasInstancePath !== undefined) {
      assert.equal(
        error.issues.some((issue) => issue.instancePath === expectation.issues?.hasInstancePath),
        true
      );
    }
    if (expectation.issues?.hasMessageIncludes !== undefined) {
      assert.equal(
        error.issues.some((issue) => issue.message.includes(expectation.issues?.hasMessageIncludes ?? "")),
        true
      );
    }
    return true;
  });
}

const validSemanticIr = loadJson("../../docs/spec/examples/semanticir/valid/canonical-v0.json");
const validPolicyProfile = loadJson(
  "../../docs/spec/examples/policyprofile/valid/production-restricted.json"
);
const validVerificationContract = loadJson(
  "../../docs/spec/examples/verificationcontract/valid/strict-stop-on-failure.json"
);

test("loadRuntimeContracts returns validated contracts for valid inputs", () => {
  const result = loadRuntimeContracts({
    semanticIr: validSemanticIr,
    policyProfile: validPolicyProfile,
    verificationContract: validVerificationContract
  });

  assert.equal(result.semanticIr.schema_version, SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION);
  assert.equal(result.policyProfile.schema_version, SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION);
  assert.equal(
    result.verificationContract.schema_version,
    SUPPORTED_VERIFICATION_CONTRACT_SCHEMA_VERSION
  );
});

test("loadRuntimeContracts rejects non-object contract payload", () => {
  expectContractValidationError(
    () => loadRuntimeContracts(undefined),
    {
      contract: "RuntimeContracts",
      code: "INVALID_INPUT",
      messageIncludes: "RuntimeContracts contract input must be an object"
    }
  );
});

test("loadRuntimeContracts rejects invalid SemanticIR payload with validation error", () => {
  const invalidSemanticIr = loadJson("../../docs/spec/examples/semanticir/invalid/missing-metadata.json");

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: invalidSemanticIr,
        policyProfile: validPolicyProfile,
        verificationContract: validVerificationContract
      }),
    {
      contract: "SemanticIR",
      code: "SCHEMA_VALIDATION_FAILED",
      messageIncludes: "SemanticIR contract validation failed",
      issues: {
        minCount: 1,
        hasKeyword: "required",
        hasMessageIncludes: "required property"
      }
    }
  );
});

test("loadRuntimeContracts rejects invalid PolicyProfile payload with validation error", () => {
  const invalidPolicyProfile = loadJson(
    "../../docs/spec/examples/policyprofile/invalid/manual-approval-without-rules.json"
  );

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: validSemanticIr,
        policyProfile: invalidPolicyProfile,
        verificationContract: validVerificationContract
      }),
    {
      contract: "PolicyProfile",
      code: "SCHEMA_VALIDATION_FAILED",
      messageIncludes: "PolicyProfile contract validation failed",
      issues: {
        minCount: 1,
        hasKeyword: "minItems",
        hasInstancePath: "/capability_policy/escalation_requirements/rules"
      }
    }
  );
});

test("loadRuntimeContracts rejects invalid VerificationContract payload with validation error", () => {
  const invalidVerificationContract = loadJson(
    "../../docs/spec/examples/verificationcontract/invalid/invalid-on-failure-decision.json"
  );

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: validSemanticIr,
        policyProfile: validPolicyProfile,
        verificationContract: invalidVerificationContract
      }),
    {
      contract: "VerificationContract",
      code: "SCHEMA_VALIDATION_FAILED",
      messageIncludes: "VerificationContract contract validation failed",
      issues: {
        minCount: 1,
        hasKeyword: "enum",
        hasInstancePath: "/continuation/on_failure"
      }
    }
  );
});

test("loadRuntimeContracts reports SemanticIR version incompatibility explicitly", () => {
  const semanticIrWithUnsupportedVersion = {
    ...(validSemanticIr as Record<string, unknown>),
    schema_version: "0.2.0"
  };

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: semanticIrWithUnsupportedVersion,
        policyProfile: validPolicyProfile,
        verificationContract: validVerificationContract
      }),
    {
      contract: "SemanticIR",
      code: "VERSION_INCOMPATIBLE",
      messageIncludes: 'incompatible; expected "0.1.0"',
      issues: {
        minCount: 1,
        hasKeyword: "const",
        hasInstancePath: "/schema_version"
      }
    }
  );
});

test("loadRuntimeContracts reports PolicyProfile version incompatibility explicitly", () => {
  const policyProfileWithUnsupportedVersion = {
    ...(validPolicyProfile as Record<string, unknown>),
    schema_version: "0.2.0"
  };

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: validSemanticIr,
        policyProfile: policyProfileWithUnsupportedVersion,
        verificationContract: validVerificationContract
      }),
    {
      contract: "PolicyProfile",
      code: "VERSION_INCOMPATIBLE",
      messageIncludes: 'incompatible; expected "0.1.0"',
      issues: {
        minCount: 1,
        hasKeyword: "const",
        hasInstancePath: "/schema_version"
      }
    }
  );
});

test("loadRuntimeContracts reports VerificationContract version incompatibility explicitly", () => {
  const verificationContractWithUnsupportedVersion = {
    ...(validVerificationContract as Record<string, unknown>),
    schema_version: "1.1.0"
  };

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: validSemanticIr,
        policyProfile: validPolicyProfile,
        verificationContract: verificationContractWithUnsupportedVersion
      }),
    {
      contract: "VerificationContract",
      code: "VERSION_INCOMPATIBLE",
      messageIncludes: 'incompatible; expected "1.0.0"',
      issues: {
        minCount: 1,
        hasKeyword: "const",
        hasInstancePath: "/schema_version"
      }
    }
  );
});

test("loadRuntimeContracts reports schema_version type errors explicitly", () => {
  const semanticIrWithTypeError = {
    ...(validSemanticIr as Record<string, unknown>),
    schema_version: 100
  };

  expectContractValidationError(
    () =>
      loadRuntimeContracts({
        semanticIr: semanticIrWithTypeError,
        policyProfile: validPolicyProfile,
        verificationContract: validVerificationContract
      }),
    {
      contract: "SemanticIR",
      code: "SCHEMA_VALIDATION_FAILED",
      messageIncludes: "schema_version must be a string",
      issues: {
        minCount: 1,
        hasKeyword: "type",
        hasInstancePath: "/schema_version"
      }
    }
  );
});
