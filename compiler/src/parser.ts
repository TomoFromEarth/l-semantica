import type {
  CapabilityDeclarationAstNode,
  CheckDeclarationAstNode,
  DocumentAstNode,
  GoalDeclarationAstNode,
  SourcePosition,
  SourceRange
} from "./ast.ts";
import type { Diagnostic, DiagnosticCode } from "./diagnostics.ts";
import { lex, type Token } from "./lexer.ts";

export interface ParseResult {
  ast: DocumentAstNode | null;
  diagnostics: Diagnostic[];
}

function clonePosition(position: SourcePosition): SourcePosition {
  return {
    offset: position.offset,
    line: position.line,
    column: position.column
  };
}

function createRange(start: SourcePosition, end: SourcePosition): SourceRange {
  return {
    start: clonePosition(start),
    end: clonePosition(end)
  };
}

class Parser {
  private readonly tokens: Token[];
  private readonly diagnostics: Diagnostic[] = [];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ParseResult {
    this.skipNewlines();
    const documentStartToken = this.current();

    const goal = this.parseGoalSection();
    const capabilities: CapabilityDeclarationAstNode[] = [];
    const checks: CheckDeclarationAstNode[] = [];

    let section: "capability" | "check" = "capability";

    while (!this.isAt("EOF")) {
      this.skipNewlines();
      const token = this.current();
      if (token.kind === "EOF") {
        break;
      }

      const startIndex = this.index;

      if (section === "capability") {
        if (token.kind === "CapabilityKeyword") {
          const declaration = this.parseCapabilityDeclaration();
          if (declaration !== null) {
            capabilities.push(declaration);
          }
        } else if (token.kind === "CheckKeyword") {
          section = "check";
          const declaration = this.parseCheckDeclaration();
          if (declaration !== null) {
            checks.push(declaration);
          }
        } else if (token.kind === "GoalKeyword") {
          this.addDiagnostic(
            "PARSE_UNEXPECTED_TOKEN",
            "Unexpected 'goal' declaration: only one goal declaration is allowed",
            token
          );
          this.skipInvalidDeclarationLine();
        } else {
          this.addDiagnostic(
            "PARSE_EXPECTED_DECLARATION",
            "Expected a capability declaration after the goal declaration",
            token
          );
          this.skipInvalidDeclarationLine();
        }
      } else if (token.kind === "CheckKeyword") {
        const declaration = this.parseCheckDeclaration();
        if (declaration !== null) {
          checks.push(declaration);
        }
      } else if (token.kind === "CapabilityKeyword") {
        this.addDiagnostic(
          "PARSE_UNEXPECTED_TOKEN",
          "Capability declarations are not allowed after check declarations begin",
          token
        );
        this.skipInvalidDeclarationLine();
      } else if (token.kind === "GoalKeyword") {
        this.addDiagnostic(
          "PARSE_UNEXPECTED_TOKEN",
          "Unexpected 'goal' declaration after check declarations",
          token
        );
        this.skipInvalidDeclarationLine();
      } else {
        this.addDiagnostic(
          "PARSE_EXPECTED_DECLARATION",
          "Expected a check declaration",
          token
        );
        this.skipInvalidDeclarationLine();
      }

      if (this.index === startIndex) {
        this.skipInvalidDeclarationLine();
      }
    }

    if (goal === null) {
      const hasStartGoalDiagnostic = this.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "PARSE_EXPECTED_DECLARATION" &&
          diagnostic.message === "Document must start with a goal declaration"
      );

      const hasInvalidGoalDeclarationDiagnostic = this.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "PARSE_EXPECTED_TOKEN" &&
          diagnostic.message === "Expected a quoted string after 'goal'"
      );

      if (!hasStartGoalDiagnostic && !hasInvalidGoalDeclarationDiagnostic) {
        this.addDiagnostic(
          "PARSE_MISSING_REQUIRED_DECLARATION",
          "Document must contain exactly one goal declaration",
          documentStartToken
        );
      }
    }

    if (capabilities.length === 0) {
      const capabilityAnchorRange =
        goal !== null
          ? createRange(goal.range.end, goal.range.end)
          : createRange(documentStartToken.range.start, documentStartToken.range.start);

      this.addDiagnosticAtRange(
        "PARSE_MISSING_REQUIRED_DECLARATION",
        "Document must contain at least one capability declaration",
        capabilityAnchorRange
      );
    }

    if (checks.length === 0) {
      const checkAnchorPosition =
        capabilities.length > 0
          ? capabilities[capabilities.length - 1].range.end
          : goal !== null
            ? goal.range.end
            : documentStartToken.range.start;
      const checkAnchorRange = createRange(checkAnchorPosition, checkAnchorPosition);

      this.addDiagnosticAtRange(
        "PARSE_MISSING_REQUIRED_DECLARATION",
        "Document must contain at least one check declaration",
        checkAnchorRange
      );
    }

    if (goal === null || capabilities.length === 0 || checks.length === 0 || this.diagnostics.length > 0) {
      return {
        ast: null,
        diagnostics: this.diagnostics
      };
    }

    const range = createRange(goal.range.start, checks[checks.length - 1].range.end);

    return {
      ast: {
        kind: "Document",
        goal,
        capabilities,
        checks,
        range
      },
      diagnostics: this.diagnostics
    };
  }

  private parseGoalSection(): GoalDeclarationAstNode | null {
    const token = this.current();
    if (token.kind !== "GoalKeyword") {
      this.addDiagnostic(
        "PARSE_EXPECTED_DECLARATION",
        "Document must start with a goal declaration",
        token
      );
      return null;
    }

    return this.parseGoalDeclaration();
  }

  private parseGoalDeclaration(): GoalDeclarationAstNode | null {
    const keywordToken = this.consume("GoalKeyword");
    if (keywordToken === null) {
      return null;
    }

    const valueToken = this.expect("StringLiteral", "Expected a quoted string after 'goal'");
    if (valueToken === null || valueToken.value === undefined) {
      this.consumeUntilLineBoundary();
      return null;
    }

    this.validateLineEnding("goal declaration");

    return {
      kind: "GoalDeclaration",
      value: valueToken.value,
      range: createRange(keywordToken.range.start, valueToken.range.end)
    };
  }

  private parseCapabilityDeclaration(): CapabilityDeclarationAstNode | null {
    const keywordToken = this.consume("CapabilityKeyword");
    if (keywordToken === null) {
      return null;
    }

    const nameToken = this.expect("Identifier", "Expected capability identifier after 'capability'");
    if (nameToken === null || nameToken.value === undefined) {
      this.consumeUntilLineBoundary();
      return null;
    }

    const descriptionToken = this.expect("StringLiteral", "Expected a quoted string after capability identifier");
    if (descriptionToken === null || descriptionToken.value === undefined) {
      this.consumeUntilLineBoundary();
      return null;
    }

    this.validateLineEnding("capability declaration");

    return {
      kind: "CapabilityDeclaration",
      name: nameToken.value,
      description: descriptionToken.value,
      range: createRange(keywordToken.range.start, descriptionToken.range.end)
    };
  }

  private parseCheckDeclaration(): CheckDeclarationAstNode | null {
    const keywordToken = this.consume("CheckKeyword");
    if (keywordToken === null) {
      return null;
    }

    const nameToken = this.expect("Identifier", "Expected check identifier after 'check'");
    if (nameToken === null || nameToken.value === undefined) {
      this.consumeUntilLineBoundary();
      return null;
    }

    const descriptionToken = this.expect("StringLiteral", "Expected a quoted string after check identifier");
    if (descriptionToken === null || descriptionToken.value === undefined) {
      this.consumeUntilLineBoundary();
      return null;
    }

    this.validateLineEnding("check declaration");

    return {
      kind: "CheckDeclaration",
      name: nameToken.value,
      description: descriptionToken.value,
      range: createRange(keywordToken.range.start, descriptionToken.range.end)
    };
  }

  private expect(kind: Token["kind"], message: string): Token | null {
    const token = this.current();
    if (token.kind === kind) {
      return this.advance();
    }

    this.addDiagnostic("PARSE_EXPECTED_TOKEN", message, token);
    return null;
  }

  private validateLineEnding(context: string): void {
    if (this.isAt("Newline") || this.isAt("EOF")) {
      return;
    }

    this.addDiagnostic(
      "PARSE_UNEXPECTED_TOKEN",
      `Unexpected token after ${context}; expected end of line`,
      this.current()
    );
    this.consumeUntilLineBoundary();
  }

  private consume(kind: Token["kind"]): Token | null {
    if (!this.isAt(kind)) {
      return null;
    }
    return this.advance();
  }

  private skipInvalidDeclarationLine(): void {
    this.consumeUntilLineBoundary();
    if (this.isAt("Newline")) {
      this.advance();
    }
  }

  private consumeUntilLineBoundary(): void {
    while (!this.isAt("EOF") && !this.isAt("Newline")) {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.isAt("Newline")) {
      this.advance();
    }
  }

  private isAt(kind: Token["kind"]): boolean {
    return this.current().kind === kind;
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    const token = this.current();
    if (this.index < this.tokens.length - 1) {
      this.index += 1;
    }
    return token;
  }

  private addDiagnostic(code: DiagnosticCode, message: string, token: Token): void {
    this.diagnostics.push({
      code,
      message,
      range: createRange(token.range.start, token.range.end)
    });
  }

  private addDiagnosticAtRange(code: DiagnosticCode, message: string, range: SourceRange): void {
    this.diagnostics.push({
      code,
      message,
      range: createRange(range.start, range.end)
    });
  }
}

export function parseLsDocument(input: string): ParseResult {
  const lexResult = lex(input);
  if (lexResult.diagnostics.length > 0) {
    return {
      ast: null,
      diagnostics: lexResult.diagnostics
    };
  }

  const parser = new Parser(lexResult.tokens);
  return parser.parse();
}
