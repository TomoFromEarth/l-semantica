import type { SourcePosition, SourceRange } from "./ast.ts";

export type DiagnosticCode =
  | "LEX_UNEXPECTED_CHARACTER"
  | "LEX_UNTERMINATED_STRING"
  | "LEX_INVALID_ESCAPE"
  | "PARSE_EXPECTED_DECLARATION"
  | "PARSE_EXPECTED_TOKEN"
  | "PARSE_UNEXPECTED_TOKEN"
  | "PARSE_MISSING_REQUIRED_DECLARATION";

export type DiagnosticSeverity = "error";

export interface DiagnosticSpan {
  file: string;
  start: SourcePosition;
  end: SourcePosition;
}

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  span: DiagnosticSpan;
}

export const DEFAULT_DIAGNOSTIC_FILE = "<input>";

const DIAGNOSTIC_SEVERITY_BY_CODE: Record<DiagnosticCode, DiagnosticSeverity> = {
  LEX_UNEXPECTED_CHARACTER: "error",
  LEX_UNTERMINATED_STRING: "error",
  LEX_INVALID_ESCAPE: "error",
  PARSE_EXPECTED_DECLARATION: "error",
  PARSE_EXPECTED_TOKEN: "error",
  PARSE_UNEXPECTED_TOKEN: "error",
  PARSE_MISSING_REQUIRED_DECLARATION: "error"
};

function clonePosition(position: SourcePosition): SourcePosition {
  return {
    offset: position.offset,
    line: position.line,
    column: position.column
  };
}

export function createDiagnosticSpan(
  start: SourcePosition,
  end: SourcePosition,
  file = DEFAULT_DIAGNOSTIC_FILE
): DiagnosticSpan {
  return {
    file,
    start: clonePosition(start),
    end: clonePosition(end)
  };
}

export function createDiagnosticSpanFromRange(
  range: SourceRange,
  file = DEFAULT_DIAGNOSTIC_FILE
): DiagnosticSpan {
  return createDiagnosticSpan(range.start, range.end, file);
}

export function createDiagnostic(
  code: DiagnosticCode,
  message: string,
  span: DiagnosticSpan
): Diagnostic {
  return {
    code,
    message,
    severity: DIAGNOSTIC_SEVERITY_BY_CODE[code],
    span
  };
}

export function emitDiagnostic(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  diagnostics.push(diagnostic);
}
