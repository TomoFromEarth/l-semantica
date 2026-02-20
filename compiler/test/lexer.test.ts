import assert from "node:assert/strict";
import test from "node:test";

import { lex } from "../src/index.ts";

test("lex tokenizes minimal .ls declarations with source locations", () => {
  const source =
    'goal "ship parser skeleton"\n' +
    'capability read_docs "inspect local documentation"\n' +
    'check include_sources "response includes source references"';

  const result = lex(source);
  assert.deepEqual(result.diagnostics, []);

  assert.deepEqual(
    result.tokens.map((token) => token.kind),
    [
      "GoalKeyword",
      "StringLiteral",
      "Newline",
      "CapabilityKeyword",
      "Identifier",
      "StringLiteral",
      "Newline",
      "CheckKeyword",
      "Identifier",
      "StringLiteral",
      "EOF"
    ]
  );

  assert.equal(result.tokens[0].range.start.line, 1);
  assert.equal(result.tokens[3].range.start.line, 2);
  assert.equal(result.tokens[7].range.start.line, 3);
});

test("lex reports unterminated strings with source location", () => {
  const source = 'goal "unterminated\ncapability read_docs "ok"';
  const result = lex(source);

  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.diagnostics[0].code, "LEX_UNTERMINATED_STRING");
  assert.equal(result.diagnostics[0].range.start.line, 1);
  assert.equal(result.diagnostics[0].range.start.column, 6);
});

test("lex reports invalid escape range at the escape sequence", () => {
  const source = String.raw`goal "bad \q escape"`; // q is intentionally invalid
  const result = lex(source);

  assert.ok(result.diagnostics.length > 0);
  const invalidEscape = result.diagnostics.find(
    (diagnostic) => diagnostic.code === "LEX_INVALID_ESCAPE"
  );

  assert.notEqual(invalidEscape, undefined);
  assert.equal(invalidEscape?.range.start.line, 1);
  assert.equal(invalidEscape?.range.start.column, 11);

  const stringToken = result.tokens.find((token) => token.kind === "StringLiteral");
  assert.notEqual(stringToken, undefined);
  assert.equal(stringToken?.value, String.raw`bad \q escape`);
});

test("lex treats inherited object-key names as identifiers", () => {
  const result = lex("constructor");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.tokens[0]?.kind, "Identifier");
  assert.equal(result.tokens[0]?.lexeme, "constructor");
});

test("lex treats backslash newline in a string as unterminated boundary", () => {
  const source = 'goal "line break\\' + "\n" + 'capability read_docs "ok"';
  const result = lex(source);
  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(diagnosticCodes.includes("LEX_UNTERMINATED_STRING"));
  assert.ok(!diagnosticCodes.includes("LEX_INVALID_ESCAPE"));
  assert.ok(result.tokens.some((token) => token.kind === "CapabilityKeyword"));
});
