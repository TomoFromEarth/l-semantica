export interface SemanticIrEnvelope {
  version: string;
  goal: string;
}

export interface RuntimeResult {
  ok: true;
  traceId: string;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

export function runSemanticIr(ir: SemanticIrEnvelope): RuntimeResult {
  if (typeof ir !== "object" || ir === null) {
    throw new Error("SemanticIR input must be an object");
  }

  const version = requireNonEmptyString(
    (ir as { version?: unknown }).version,
    "SemanticIR version is required"
  );
  requireNonEmptyString((ir as { goal?: unknown }).goal, "SemanticIR goal is required");

  return {
    ok: true,
    traceId: `trace-${version}`
  };
}
