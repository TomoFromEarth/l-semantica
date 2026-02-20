export interface GoalAstNode {
  kind: "GoalDeclaration";
  value: string;
}

export function parseGoalDeclaration(input: string): GoalAstNode {
  const normalized = input.trim();
  if (normalized.length === 0) {
    throw new Error("Goal declaration cannot be empty");
  }

  return {
    kind: "GoalDeclaration",
    value: normalized
  };
}

export { lex } from "./lexer.ts";
export { parseLsDocument } from "./parser.ts";
export type { DocumentAstNode, GoalDeclarationAstNode, CapabilityDeclarationAstNode, CheckDeclarationAstNode, SourcePosition, SourceRange } from "./ast.ts";
export type { Diagnostic, DiagnosticCode } from "./diagnostics.ts";
export type { LexResult, Token, TokenKind } from "./lexer.ts";
export type { ParseResult } from "./parser.ts";
