import type { SourcePosition, SourceRange } from "./ast.ts";
import type { Diagnostic } from "./diagnostics.ts";

export type TokenKind =
  | "GoalKeyword"
  | "CapabilityKeyword"
  | "CheckKeyword"
  | "Identifier"
  | "StringLiteral"
  | "Newline"
  | "EOF";

export interface Token {
  kind: TokenKind;
  lexeme: string;
  value?: string;
  range: SourceRange;
}

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const KEYWORD_KINDS: Record<string, TokenKind> = {
  goal: "GoalKeyword",
  capability: "CapabilityKeyword",
  check: "CheckKeyword"
};

function createPosition(offset: number, line: number, column: number): SourcePosition {
  return { offset, line, column };
}

function clonePosition(position: SourcePosition): SourcePosition {
  return createPosition(position.offset, position.line, position.column);
}

function createRange(start: SourcePosition, end: SourcePosition): SourceRange {
  return {
    start: clonePosition(start),
    end: clonePosition(end)
  };
}

function isLetter(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function isIdentifierPart(value: string): boolean {
  return /[A-Za-z0-9_-]/.test(value);
}

function decodeEscape(value: string): string | null {
  if (value === "\\") {
    return "\\";
  }

  if (value === "\"") {
    return "\"";
  }

  if (value === "n") {
    return "\n";
  }

  if (value === "t") {
    return "\t";
  }

  return null;
}

export function lex(input: string): LexResult {
  const diagnostics: Diagnostic[] = [];
  const tokens: Token[] = [];
  const source = input;

  let index = 0;
  let line = 1;
  let column = 1;

  function currentPosition(): SourcePosition {
    return createPosition(index, line, column);
  }

  function currentChar(): string | undefined {
    return source[index];
  }

  function nextChar(): string | undefined {
    return source[index + 1];
  }

  function advance(): string {
    const value = source[index] ?? "";
    index += 1;
    if (value === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return value;
  }

  function addToken(kind: TokenKind, start: SourcePosition, end: SourcePosition, lexeme: string, value?: string): void {
    tokens.push({
      kind,
      lexeme,
      value,
      range: createRange(start, end)
    });
  }

  function addDiagnostic(code: Diagnostic["code"], message: string, start: SourcePosition, end: SourcePosition): void {
    diagnostics.push({
      code,
      message,
      range: createRange(start, end)
    });
  }

  while (index < source.length) {
    const value = currentChar();
    if (value === undefined) {
      break;
    }

    if (value === " " || value === "\t") {
      advance();
      continue;
    }

    if (value === "\n") {
      const start = currentPosition();
      advance();
      const end = currentPosition();
      addToken("Newline", start, end, "\n");
      continue;
    }

    if (value === "\r" && nextChar() === "\n") {
      const start = currentPosition();
      advance();
      advance();
      const end = currentPosition();
      addToken("Newline", start, end, "\r\n");
      continue;
    }

    if (value === "\"") {
      const start = currentPosition();
      let lexeme = "";
      let parsedValue = "";

      lexeme += advance();

      let terminated = false;
      while (index < source.length) {
        const char = currentChar();
        if (char === undefined) {
          break;
        }

        if (char === "\"") {
          lexeme += advance();
          terminated = true;
          break;
        }

        if (char === "\n" || char === "\r") {
          break;
        }

        if (char === "\\") {
          lexeme += advance();
          const escaped = currentChar();
          if (escaped === undefined) {
            break;
          }

          lexeme += advance();
          const decoded = decodeEscape(escaped);
          if (decoded === null) {
            addDiagnostic(
              "LEX_INVALID_ESCAPE",
              `Invalid string escape sequence "\\${escaped}"`,
              start,
              currentPosition()
            );
          } else {
            parsedValue += decoded;
          }
          continue;
        }

        parsedValue += char;
        lexeme += advance();
      }

      if (!terminated) {
        addDiagnostic(
          "LEX_UNTERMINATED_STRING",
          "Unterminated string literal",
          start,
          currentPosition()
        );
      } else {
        addToken("StringLiteral", start, currentPosition(), lexeme, parsedValue);
      }
      continue;
    }

    if (isLetter(value)) {
      const start = currentPosition();
      let lexeme = "";
      while (index < source.length) {
        const part = currentChar();
        if (part === undefined || !isIdentifierPart(part)) {
          break;
        }
        lexeme += advance();
      }

      const keywordKind = KEYWORD_KINDS[lexeme];
      addToken(keywordKind ?? "Identifier", start, currentPosition(), lexeme, lexeme);
      continue;
    }

    const start = currentPosition();
    const unexpected = advance();
    addDiagnostic(
      "LEX_UNEXPECTED_CHARACTER",
      `Unexpected character "${unexpected}"`,
      start,
      currentPosition()
    );
  }

  const eofPosition = currentPosition();
  addToken("EOF", eofPosition, eofPosition, "");

  return {
    tokens,
    diagnostics
  };
}
