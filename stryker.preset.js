import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { fileURLToPath } from "node:url";
import { GUARD_IGNORER } from "./dist/mutation/mutation-guard-plugin.js";
import { fullRunRefusal } from "./dist/mutation/mutation-refusal.js";

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

export const unitTestFiles = listedUnitTests;

const testFiles = unitTestFiles();

const resolvedBunfig = () => {
  if (command !== "run" || !existsSync("bunfig.toml")) return undefined;
  const config = parse(readFileSync("bunfig.toml", "utf8"));
  const resolve = createRequire(join(process.cwd(), "package.json")).resolve;
  const original = stringify(config);
  const resolvePreload = (preload) => {
    if (typeof preload !== "string" || preload.startsWith(".") || isAbsolute(preload)) return preload;
    return resolve(preload);
  };
  const resolvePreloads = (value) => Array.isArray(value) ? value.map(resolvePreload) : resolvePreload(value);
  if (Object.hasOwn(config, "preload")) config.preload = resolvePreloads(config.preload);
  if (typeof config.test === "object" && Object.hasOwn(config.test, "preload")) config.test.preload = resolvePreloads(config.test.preload);
  if (stringify(config) === original) return undefined;
  const directory = mkdtempSync(join(tmpdir(), "checks-mutation-bunfig-"));
  const path = join(directory, "bunfig.toml");
  writeFileSync(path, stringify(config));
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  return path;
};
const bunfig = resolvedBunfig();

const timeoutMS = 60000;
const timeoutFactor = 1.5;
const dryRunTimeoutMinutes = 5;

// The bun runner holds bun.timeout over a whole bun test child rather than one test, so any value under Stryker's own deadlines kills a healthy suite that outruns it.
// A mutant's Stryker deadline is timeoutFactor times its net time plus timeoutMS plus the dry run's overhead, and net time and overhead each stay under the dry-run deadline.
const runnerChildTimeout = (timeoutFactor + 1) * dryRunTimeoutMinutes * 60000 + timeoutMS;

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
  bun: { timeout: runnerChildTimeout, ...(testFiles.length > 0 ? { testFiles } : {}), ...(bunfig ? { bunArgs: [`--config=${bunfig}`] } : {}) },
  inPlace: true,
  tempDirName: "../.stryker-tmp",
  coverageAnalysis: "perTest",
  reporters: ["html", "json", "clear-text", "progress"],
  timeoutMS,
  timeoutFactor,
  dryRunTimeoutMinutes,
  concurrency: mutationConcurrency(process.env.RUNNER_ENVIRONMENT, availableParallelism()),
  ignoreStatic: ignoresStatic(process.env.CHECKS_MUTATION_MODE),
  thresholds: { high: 85, low: 70, break: null },
};
