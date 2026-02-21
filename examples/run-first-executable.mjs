import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLsDocument } from "../compiler/src/index.ts";
import { runSemanticIr } from "../runtime/src/index.ts";

function readExampleSource(examplePath) {
  return readFileSync(examplePath, "utf8");
}

function parseExample(source) {
  const parsed = parseLsDocument(source);
  if (parsed.ast === null || parsed.diagnostics.length > 0) {
    throw new Error(
      JSON.stringify(
        {
          message: "Example failed to parse",
          diagnostics: parsed.diagnostics
        },
        null,
        2
      )
    );
  }

  return parsed.ast;
}

function toRuntimeInput(ast) {
  return {
    version: "0.1.0",
    goal: ast.goal.value
  };
}

function main() {
  const examplesRoot = fileURLToPath(new URL(".", import.meta.url));
  const inputPath = resolve(examplesRoot, process.argv[2] ?? "./first-executable.ls");

  const source = readExampleSource(inputPath);
  const ast = parseExample(source);
  const runtimeInput = toRuntimeInput(ast);
  const runtimeResult = runSemanticIr(runtimeInput);

  console.log(
    JSON.stringify(
      {
        ok: runtimeResult.ok,
        inputPath,
        runtimeInput,
        runtimeResult
      },
      null,
      2
    )
  );
}

main();
