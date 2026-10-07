import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { GUARD_IGNORER } from "./src/testing/mutation-guard-plugin.js";
import { fullRunRefusal } from "./src/testing/mutation-scope.js";

const [, , command, ...args] = process.argv;
const refusal = command === "run" ? fullRunRefusal(args, process.env.CI ?? "") : undefined;
if (refusal !== undefined) throw new Error(refusal);

export const halfAvailableCores = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

export default {
  packageManager: "npm",
  plugins: [
    "@stryker-mutator/*",
    "@hughescr/stryker-bun-runner",
    fileURLToPath(new URL("./src/testing/mutation-guard-plugin.js", import.meta.url)),
  ],
  ignorers: [GUARD_IGNORER],
  testRunner: "bun",
  bun: { timeout: 60000 },
  inPlace: true,
  tempDirName: "../.stryker-tmp",
  coverageAnalysis: "perTest",
  reporters: ["html", "json", "clear-text", "progress"],
  timeoutMS: 60000,
  concurrency: halfAvailableCores(),
  thresholds: { high: 85, low: 70, break: null },
};
