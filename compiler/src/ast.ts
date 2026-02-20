export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface GoalDeclarationAstNode {
  kind: "GoalDeclaration";
  value: string;
  range: SourceRange;
}

export interface CapabilityDeclarationAstNode {
  kind: "CapabilityDeclaration";
  name: string;
  description: string;
  range: SourceRange;
}

export interface CheckDeclarationAstNode {
  kind: "CheckDeclaration";
  name: string;
  description: string;
  range: SourceRange;
}

export interface DocumentAstNode {
  kind: "Document";
  goal: GoalDeclarationAstNode;
  capabilities: CapabilityDeclarationAstNode[];
  checks: CheckDeclarationAstNode[];
  range: SourceRange;
}
