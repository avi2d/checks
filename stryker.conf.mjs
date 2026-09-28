import { availableParallelism } from "node:os";
import preset from "./stryker.preset.js";

export default {
  ...preset,
  bun: {
    ...preset.bun,
    testFiles: ["./tests/unit/"],
  },
  // Only unit tests run per mutant: the e2e tests spawn processes and take minutes each.
  // Mutants run in place, as the preset sets: with TypeScript 7 Stryker cannot rewrite the tsconfig a sandbox copy needs.
  ignorePatterns: ["/dist", "/repos", "/scripts", "/stryker.conf.mjs", "/stryker.preset.js", "/tests/e2e", "/tests/fixtures"],
  // A fixed count oversubscribes a smaller CI runner, and the extra Timeouts count as killed.
  concurrency: availableParallelism(),
};
