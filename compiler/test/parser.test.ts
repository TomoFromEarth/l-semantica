import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseLsDocument } from "../src/index.ts";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

function loadSpecExample(relativePath: string): string {
  return readFileSync(path.resolve(testDirectory, "../../docs/spec/examples", relativePath), "utf8");
}

test("parseLsDocument parses minimal valid example into AST root", () => {
  const source = loadSpecExample("valid/minimal-goal-capability-check.ls");
  const result = parseLsDocument(source);

  assert.equal(result.diagnostics.length, 0);
  assert.notEqual(result.ast, null);

  const ast = result.ast;
  assert.equal(ast?.kind, "Document");
  assert.equal(ast?.goal.value, "answer user requests with grounded output");
  assert.equal(ast?.capabilities.length, 1);
  assert.equal(ast?.capabilities[0]?.name, "retrieve_docs");
  assert.equal(ast?.checks.length, 1);
  assert.equal(ast?.checks[0]?.name, "include_references");
});

test("parseLsDocument parses multi declaration valid example", () => {
  const source = loadSpecExample("valid/multi-capability-check.ls");
  const result = parseLsDocument(source);

  assert.equal(result.diagnostics.length, 0);
  assert.notEqual(result.ast, null);
  assert.equal(result.ast?.capabilities.length, 2);
  assert.equal(result.ast?.checks.length, 2);
});

test("parseLsDocument returns actionable diagnostics for missing goal", () => {
  const source = loadSpecExample("invalid/missing-goal.ls");
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("goal declaration")
    )
  );
  assert.ok(
    result.diagnostics.every((diagnostic) => diagnostic.range.start.line >= 1)
  );
});

test("parseLsDocument returns actionable diagnostics for unquoted goal string", () => {
  const source = loadSpecExample("invalid/unquoted-goal-string.ls");
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("quoted string after 'goal'")
    )
  );
  assert.equal(
    result.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("Unexpected token after goal declaration")
    ).length,
    0
  );
  assert.equal(
    result.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("Document must contain exactly one goal declaration")
    ).length,
    0
  );
  assert.equal(result.diagnostics[0].range.start.line, 1);
});

test("parseLsDocument does not discard declarations when goal is missing", () => {
  const source =
    'capability retrieve_docs "read local docs"\n' +
    'check include_references "response includes references"';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Document must start with a goal declaration")
    )
  );
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Document must contain exactly one goal declaration")
    ),
    false
  );
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("at least one capability declaration")
    ),
    false
  );
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("at least one check declaration")
    ),
    false
  );
});

test("parseLsDocument anchors missing capability diagnostic near goal declaration", () => {
  const source = 'goal "ship parser"\n\n';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  const capabilityDiagnostic = result.diagnostics.find((diagnostic) =>
    diagnostic.message.includes("at least one capability declaration")
  );

  assert.notEqual(capabilityDiagnostic, undefined);
  assert.equal(capabilityDiagnostic?.range.start.line, 1);
});

test("parseLsDocument anchors missing check diagnostic near last capability", () => {
  const source = 'goal "ship parser"\ncapability read_docs "read docs"\n\n';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  const checkDiagnostic = result.diagnostics.find((diagnostic) =>
    diagnostic.message.includes("at least one check declaration")
  );

  assert.notEqual(checkDiagnostic, undefined);
  assert.equal(checkDiagnostic?.range.start.line, 2);
});

test("parseLsDocument suppresses missing capability diagnostic when capability is malformed", () => {
  const source =
    'goal "ship parser"\n' +
    'capability "missing id"\n' +
    'check include_references "response includes references"';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("at least one capability declaration")
    ),
    false
  );
});

test("parseLsDocument suppresses missing check diagnostic when check is malformed", () => {
  const source =
    'goal "ship parser"\n' +
    'capability read_docs "read docs"\n' +
    'check "missing id"';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("at least one check declaration")
    ),
    false
  );
});

test("parseLsDocument avoids cascading capability diagnostics when identifier is missing", () => {
  const source =
    'goal "ship parser"\n' +
    'capability "missing id"\n' +
    'check include_references "response includes references"';
  const result = parseLsDocument(source);

  assert.equal(result.ast, null);
  assert.equal(
    result.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("Expected capability identifier")
    ).length,
    1
  );
  assert.equal(
    result.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("Expected a quoted string after capability identifier")
    ).length,
    0
  );
});
