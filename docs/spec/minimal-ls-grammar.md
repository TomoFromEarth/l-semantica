# Minimal `.ls` Grammar (M0 / Issue #5)

This document defines the smallest language surface required for M0:

- `goal` declaration
- `capability` declarations
- `check` assertions

## EBNF

```ebnf
document        = ws, goal-declaration, declaration-separator, capability-section, declaration-separator, check-section, ws ;

goal-declaration = "goal", wsp, string-literal ;

capability-section = capability-declaration, { declaration-separator, capability-declaration } ;
capability-declaration = "capability", wsp, identifier, wsp, string-literal ;

check-section   = check-declaration, { declaration-separator, check-declaration } ;
check-declaration = "check", wsp, identifier, wsp, string-literal ;

declaration-separator = nl, { opt-wsp, nl } ;
opt-wsp         = { wsp-char } ;

identifier      = letter, { letter | digit | "_" | "-" } ;

string-literal  = "\"", { string-char | escape }, "\"" ;
string-char     = ? any character except double quote, backslash, and line break ? ;
escape          = "\\", ( "\\" | "\"" | "n" | "t" ) ;

wsp             = wsp-char, { wsp-char } ;
wsp-char        = " " | "\t" ;
ws              = { wsp-char | nl } ;
nl              = "\n" | "\r\n" ;

letter          = "A"..."Z" | "a"..."z" ;
digit           = "0"..."9" ;
```

## Minimal Constraints

- Exactly one `goal` declaration.
- At least one `capability` declaration.
- At least one `check` declaration.
- Declarations are ordered as `goal`, then `capability`, then `check`.
- Blank lines between declarations are allowed.
- Trailing newline at end-of-file is optional.
- Strings must be double-quoted.

## Valid Examples

- `docs/spec/examples/valid/minimal-goal-capability-check.ls`
- `docs/spec/examples/valid/multi-capability-check.ls`

## Invalid Examples

- `docs/spec/examples/invalid/missing-goal.ls` (missing required `goal` declaration)
- `docs/spec/examples/invalid/unquoted-goal-string.ls` (`goal` string is not quoted)

## Acceptance Criteria Mapping

- Grammar doc covers minimal syntax set: EBNF above defines only `goal`, `capability`, `check`.
- Examples parse intent clearly: valid and invalid `.ls` samples are included in `docs/spec/examples/`.
- Scope is intentionally minimal: no additional declarations, control flow, types, imports, or policy syntax are defined here.
