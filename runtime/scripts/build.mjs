import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/BUILD_ARTIFACT.txt",
  "runtime build placeholder for M0 workspace bootstrap\n",
  "utf8"
);
