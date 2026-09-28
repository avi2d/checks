import { fullRunRefusal } from "./src/testing/mutation-scope.js";

const [, , command, ...args] = process.argv;
const refusal = command === "run" ? fullRunRefusal(args, process.env.CI ?? "") : undefined;
if (refusal !== undefined) throw new Error(refusal);

export default {
  packageManager: "npm",
  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  bun: { timeout: 60000 },
  inPlace: true,
  tempDirName: "../.stryker-tmp",
  coverageAnalysis: "perTest",
  reporters: ["html", "json", "clear-text", "progress"],
  timeoutMS: 60000,
  concurrency: 8,
  thresholds: { high: 85, low: 70, break: null },
};
