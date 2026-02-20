import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

export interface SemanticIrContract {
  schema_version: string;
  metadata: {
    ir_id: string;
    created_at: string;
    source: string;
  };
  goal: string;
  deterministic_nodes: unknown[];
  stochastic_nodes: unknown[];
}

export interface PolicyProfileContract {
  schema_version: string;
  metadata: {
    profile_id: string;
    environment: "development" | "staging" | "production";
    created_at: string;
    source: string;
  };
  capability_policy: {
    allow: string[];
    deny: string[];
    escalation_requirements: {
      default: "none" | "manual_approval";
      rules: unknown[];
    };
  };
  constraints: {
    max_autonomous_steps: number;
    max_runtime_seconds: number;
    require_human_review_on_policy_violation: boolean;
  };
}

export interface RuntimeContracts {
  semanticIr: SemanticIrContract;
  policyProfile: PolicyProfileContract;
}

export type ContractName = "RuntimeContracts" | "SemanticIR" | "PolicyProfile";
export type ContractValidationCode =
  | "INVALID_INPUT"
  | "VERSION_INCOMPATIBLE"
  | "SCHEMA_VALIDATION_FAILED";

export interface ContractValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
}

export class ContractValidationError extends Error {
  readonly contract: ContractName;
  readonly code: ContractValidationCode;
  readonly issues: ContractValidationIssue[];

  constructor(params: {
    contract: ContractName;
    code: ContractValidationCode;
    message: string;
    issues?: ContractValidationIssue[];
  }) {
    super(params.message);
    this.name = "ContractValidationError";
    this.contract = params.contract;
    this.code = params.code;
    this.issues = params.issues ?? [];
  }
}

export const SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION = "0.1.0";
export const SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION = "0.1.0";

type Ajv2020Constructor = new (options: { allErrors: boolean }) => {
  compile(schema: object): ValidateFunction;
};

interface ContractValidators {
  validateSemanticIr: ValidateFunction;
  validatePolicyProfile: ValidateFunction;
}

const require = createRequire(import.meta.url);
const Ajv2020 = resolveAjv2020Constructor();
let contractValidators: ContractValidators | null = null;

function resolveAjv2020Constructor(): Ajv2020Constructor {
  const moduleValue = require("ajv/dist/2020.js") as
    | Ajv2020Constructor
    | { default?: Ajv2020Constructor; Ajv2020?: Ajv2020Constructor };

  if (typeof moduleValue === "function") {
    return moduleValue;
  }
  if (moduleValue.default && typeof moduleValue.default === "function") {
    return moduleValue.default;
  }
  if (moduleValue.Ajv2020 && typeof moduleValue.Ajv2020 === "function") {
    return moduleValue.Ajv2020;
  }

  throw new Error("Unable to resolve Ajv2020 constructor");
}

function getContractValidators(): ContractValidators {
  if (contractValidators) {
    return contractValidators;
  }

  const ajv = new Ajv2020({ allErrors: true });
  contractValidators = {
    validateSemanticIr: ajv.compile(loadSchema("../../docs/spec/schemas/semanticir-v0.schema.json")),
    validatePolicyProfile: ajv.compile(loadSchema("../../docs/spec/schemas/policyprofile-v0.schema.json"))
  };

  return contractValidators;
}

function loadSchema(relativePathFromContractsSource: string): object {
  const fileContents = readFileSync(new URL(relativePathFromContractsSource, import.meta.url), "utf8");
  return JSON.parse(fileContents) as object;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, contract: ContractName): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractValidationError({
      contract,
      code: "INVALID_INPUT",
      message: `${contract} contract input must be an object`
    });
  }

  return value;
}

function mapAjvIssues(errors: ErrorObject[] | null | undefined): ContractValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "validation failed"
  }));
}

function requireCompatibleSchemaVersion(
  contract: "SemanticIR" | "PolicyProfile",
  value: Record<string, unknown>,
  expectedVersion: string
): void {
  const schemaVersion = value.schema_version;
  if (typeof schemaVersion !== "string" || schemaVersion.trim().length === 0) {
    throw new ContractValidationError({
      contract,
      code: "SCHEMA_VALIDATION_FAILED",
      message: `${contract} schema_version is required`,
      issues: [
        {
          instancePath: "/schema_version",
          keyword: "required",
          message: "schema_version is required"
        }
      ]
    });
  }

  if (schemaVersion !== expectedVersion) {
    throw new ContractValidationError({
      contract,
      code: "VERSION_INCOMPATIBLE",
      message: `${contract} schema_version "${schemaVersion}" is incompatible; expected "${expectedVersion}"`,
      issues: [
        {
          instancePath: "/schema_version",
          keyword: "const",
          message: `expected "${expectedVersion}"`
        }
      ]
    });
  }
}

function validateContract(
  contract: "SemanticIR" | "PolicyProfile",
  validator: ValidateFunction,
  value: Record<string, unknown>
): void {
  const valid = validator(value);
  if (!valid) {
    const issues = mapAjvIssues(validator.errors);
    const firstIssue = issues[0];
    const issuePath = firstIssue?.instancePath || "/";
    const issueMessage = firstIssue?.message ?? "validation failed";

    throw new ContractValidationError({
      contract,
      code: "SCHEMA_VALIDATION_FAILED",
      message: `${contract} contract validation failed at ${issuePath}: ${issueMessage}`,
      issues
    });
  }
}

export function loadSemanticIrContract(input: unknown): SemanticIrContract {
  const candidate = requireRecord(input, "SemanticIR");
  const { validateSemanticIr } = getContractValidators();
  requireCompatibleSchemaVersion("SemanticIR", candidate, SUPPORTED_SEMANTIC_IR_SCHEMA_VERSION);
  validateContract("SemanticIR", validateSemanticIr, candidate);
  return candidate as unknown as SemanticIrContract;
}

export function loadPolicyProfileContract(input: unknown): PolicyProfileContract {
  const candidate = requireRecord(input, "PolicyProfile");
  const { validatePolicyProfile } = getContractValidators();
  requireCompatibleSchemaVersion("PolicyProfile", candidate, SUPPORTED_POLICY_PROFILE_SCHEMA_VERSION);
  validateContract("PolicyProfile", validatePolicyProfile, candidate);
  return candidate as unknown as PolicyProfileContract;
}

export function loadRuntimeContracts(input: unknown): RuntimeContracts {
  const candidate = requireRecord(input, "RuntimeContracts");

  return {
    semanticIr: loadSemanticIrContract(candidate.semanticIr),
    policyProfile: loadPolicyProfileContract(candidate.policyProfile)
  };
}
