import { chmodSync, readFileSync, statSync } from "node:fs";
import preset from "./stryker.preset.js";

// In place, Stryker restores each file it rewrote by renaming a fresh copy over it, which drops a bin's executable bit.
const binModes = new Map(
  Object.values(JSON.parse(readFileSync("package.json", "utf8")).bin).map((file) => [file, statSync(file).mode]),
);
process.once("exit", () => {
  for (const [file, mode] of binModes) chmodSync(file, mode);
});

export default {
  ...preset,
  bun: {
    ...preset.bun,
    testFiles: ["./tests/unit/"],
  },
  // Only unit tests run per mutant: the e2e tests spawn processes and take minutes each.
  // Mutants run in place, as the preset sets: with TypeScript 7 Stryker cannot rewrite the tsconfig a sandbox copy needs.
  ignorePatterns: ["/dist", "/repos", "/scripts", "/stryker.conf.mjs", "/stryker.preset.js", "/tests/e2e", "/tests/fixtures"],
};
