import { existsSync } from "node:fs";

const requiredPaths = ["package.json", "tsconfig.json", "src/index.ts", "test/smoke.test.ts"];

for (const path of requiredPaths) {
  if (!existsSync(path)) {
    console.error(`Missing required compiler file: ${path}`);
    process.exit(1);
  }
}
