export interface SemanticIrEnvelope {
  version: string;
  goal: string;
}

export interface RuntimeResult {
  ok: true;
  traceId: string;
}

export function runSemanticIr(ir: SemanticIrEnvelope): RuntimeResult {
  if (ir.version.trim().length === 0) {
    throw new Error("SemanticIR version is required");
  }

  if (ir.goal.trim().length === 0) {
    throw new Error("SemanticIR goal is required");
  }

  return {
    ok: true,
    traceId: `trace-${ir.version}`
  };
}
