import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { GUARD_IGNORER } from "./dist/mutation/mutation-guard-plugin.js";
import { fullRunRefusal } from "./dist/mutation/mutation-refusal.js";
import { ordersTests, runOrder } from "./dist/mutation/unit-test-order.js";

const [, , command, ...args] = process.argv;
const refusal = command === "run" ? fullRunRefusal(args, process.env.CI ?? "") : undefined;
if (refusal !== undefined) throw new Error(refusal);

// A GitHub-hosted runner is a VM the job holds alone, while any other machine shares its cores with whatever else runs there.
export const mutationConcurrency = (environment, cores) =>
  environment === "github-hosted" ? cores : Math.max(1, Math.floor(cores / 2));

export const ignoresStatic = (mode) => mode === "refresh";

const UNIT_TESTS = "tests/unit";

// The bun runner narrows a mutant's run to its covering files only when each listed path equals a test id's file part, which carries no leading ./.
const listedUnitTests = () =>
  existsSync(UNIT_TESTS)
    ? readdirSync(UNIT_TESTS, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
        .map((name) => `${UNIT_TESTS}/${name}`)
        .toSorted()
    : [];

const timedUnitTests = ordersTests(command, args) && !ignoresStatic(process.env.CHECKS_MUTATION_MODE) ? await runOrder(listedUnitTests()) : undefined;

export const unitTestFiles = () => timedUnitTests ?? listedUnitTests();

const testFiles = unitTestFiles();

export default {
  packageManager: "npm",
  plugins: [
    "@stryker-mutator/*",
    "@hughescr/stryker-bun-runner",
    fileURLToPath(new URL("./dist/mutation/mutation-guard-plugin.js", import.meta.url)),
  ],
  ignorers: [GUARD_IGNORER],
  testRunner: "bun",
  // The runner warns on an empty list before it finds every test itself, as it does for an absent one.
  bun: { timeout: 60000, ...(testFiles.length > 0 ? { testFiles } : {}) },
  inPlace: true,
  tempDirName: "../.stryker-tmp",
  coverageAnalysis: "perTest",
  reporters: ["html", "json", "clear-text", "progress"],
  timeoutMS: 60000,
  concurrency: mutationConcurrency(process.env.RUNNER_ENVIRONMENT, availableParallelism()),
  ignoreStatic: ignoresStatic(process.env.CHECKS_MUTATION_MODE),
  thresholds: { high: 85, low: 70, break: null },
};
