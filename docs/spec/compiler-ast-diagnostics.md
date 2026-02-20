# Compiler AST and Diagnostics Primitives (M0 / Issue #7)

This document describes the minimal exported compiler primitives used by M0 lexer/parser work.

## AST Types

Exported from `compiler/src/index.ts`:

- `SourcePosition`: `{ offset, line, column }`
- `SourceRange`: `{ start, end }`
- `GoalDeclarationAstNode`
- `CapabilityDeclarationAstNode`
- `CheckDeclarationAstNode`
- `DocumentAstNode`

All declaration nodes carry `range: SourceRange` for source spans.

## Diagnostic Shape

Exported from `compiler/src/index.ts`:

- `DiagnosticCode`
- `DiagnosticSeverity`
- `DiagnosticSpan`
- `Diagnostic`

`Diagnostic` shape:

- `code`: stable machine-readable code.
- `message`: actionable human-readable text.
- `severity`: currently `error` for M0 diagnostics.
- `span`: `{ file, start, end }`.

M0 parsers/lexers use `"<input>"` for `span.file` when parsing in-memory text.

## Emission Helpers

The following utilities are exported for consistent diagnostic creation:

- `createDiagnosticSpan(start, end, file?)`
- `createDiagnosticSpanFromRange(range, file?)`
- `createDiagnostic(code, message, span)`
- `emitDiagnostic(diagnostics, diagnostic)`
