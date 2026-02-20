import type { SourceRange } from "./ast.ts";

export type DiagnosticCode =
  | "LEX_UNEXPECTED_CHARACTER"
  | "LEX_UNTERMINATED_STRING"
  | "LEX_INVALID_ESCAPE"
  | "PARSE_EXPECTED_DECLARATION"
  | "PARSE_EXPECTED_TOKEN"
  | "PARSE_UNEXPECTED_TOKEN"
  | "PARSE_MISSING_REQUIRED_DECLARATION";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  range: SourceRange;
}
