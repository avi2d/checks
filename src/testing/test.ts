#!/usr/bin/env bun
import { availableParallelism, freemem, totalmem } from "node:os";
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { ciCores } from "../core/ci-cores.ts";
import { collect } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { refuseLocalTests } from "../core/local-tests.ts";
import { decodeSetting, loadSettings, refuseOldPlace, Smoke, TestFileTimings } from "../core/settings.ts";
import { testOptions, type TestOptions, type TestTier } from "../core/test-script.ts";
import { readRunScope } from "../core/pull-request-scope.ts";
import { readChangedNarrowing, readLocalNarrowing } from "./affected-tests.ts";
import { changedLocalPaths } from "./changed-tests.ts";
import { judgeTestFileTimes, resolveTestFileMaxSeconds } from "./test-file-time.ts";
import { APPROVE_VARIABLE, heavyRunRefusal, pullRequestRunRefusal } from "./test-refusal.ts";
import { readSuiteScope, readTestFileSkips, type SuiteSelection } from "./test-selection.ts";
import { parseShard, type Shard } from "../core/shard.ts";
import { scanTestFiles, selectedTierFile, type Environment, type SkipDeclaration } from "./test-skips.ts";
import { fileSeconds, NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

export { suiteArgs, type SuiteSelection } from "./test-selection.ts";
export type { Environment, SkipDeclaration } from "./test-skips.ts";
export { scriptOptions, testOptions, type TestOptions } from "../core/test-script.ts";

export type Verdict = {
  readonly environment: Environment;
  readonly skipped: number;
  readonly undeclared: readonly TestResult[];
  readonly stale: readonly SkipDeclaration[];
  readonly unjudged: number;
};

export class SkipGateError extends Schema.TaggedError<SkipGateError>()("SkipGateError", {
  message: Schema.String,
}) {}

class RunRefusal extends Schema.TaggedError<RunRefusal>()("RunRefusal", {
  message: Schema.String,
}) {}

const NAME = TEST_ENTRY_POINT.bin;
const USAGE = `usage: ${NAME} [--tier=live | --tier=pixel | --tier=unit | --tier=e2e | --full | --changed | --pr | --pr-screens] [--parallel=<workers>] [--junit=<file>] [--shard=<index>/<count>], with --pr optionally combined with --tier=unit or --tier=e2e, and it refuses test filters`;
const JUNIT = /^--junit=(.+)$/;

export type EntryRun = "default" | "changed" | "pr" | "pr-screens";

const RUN_FLAGS: ReadonlyMap<string, EntryRun> = new Map([
  ["--changed", "changed"],
  ["--pr", "pr"],
  ["--pr-screens", "pr-screens"],
]);

export type EntryOptions = {
  readonly options: TestOptions;
  readonly junit: Option.Option<string>;
  readonly run: EntryRun;
  readonly shard?: Shard;
};

function refusedCombination(run: EntryRun, options: TestOptions, shard: Shard | undefined): boolean {
  if ((run === "changed" || run === "pr-screens") && options.tier !== undefined) return true;
  if (run !== "default" && options.full === true) return true;
  if (run === "pr" && (options.tier === "live" || options.tier === "pixel")) return true;
  return shard !== undefined && (options.tier === undefined || (run !== "default" && run !== "pr"));
}

export function entryOptions(args: readonly string[]): EntryOptions | undefined {
  const junit = args.flatMap((arg) => JUNIT.exec(arg)?.[1] ?? []);
  const runs = args.flatMap((arg) => RUN_FLAGS.get(arg) ?? []);
  const shardArgs = args.filter((arg) => arg.startsWith("--shard="));
  const shard = shardArgs.length === 1 ? parseShard(shardArgs[0] ?? "") : undefined;
  const options = testOptions(args.filter((arg) => !JUNIT.test(arg) && !RUN_FLAGS.has(arg) && !arg.startsWith("--shard=")));
  if (options === undefined || junit.length > 1 || runs.length > 1 || shardArgs.length > 1 || (shardArgs.length === 1 && shard === undefined)) return undefined;
  const [run = "default"] = runs;
  if (refusedCombination(run, options, shard)) return undefined;
  return { options, junit: Option.fromNullishOr(junit[0]), run, ...(shard === undefined ? {} : { shard }) };
}

function matches(declaration: SkipDeclaration, result: TestResult): boolean {
  const { name } = declaration;
  return (
    declaration.file === result.file &&
    declaration.line === result.line &&
    (result.name === name || result.name.endsWith(`${NAME_SEPARATOR}${name}`))
  );
}

function skippedOutcome(result: TestResult): boolean {
  return result.outcome === "skipped" || result.outcome === "todo";
}

function byPlace(a: TestResult, b: TestResult): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name);
}

export function judgeSkips(
  results: readonly TestResult[],
  declarations: readonly SkipDeclaration[],
  environment: Environment,
): Verdict {
  const skipped = results.filter(skippedOutcome);
  const applying = declarations.filter((declaration) => (declaration.when ?? environment) === environment);
  return {
    environment,
    skipped: skipped.length,
    undeclared: skipped.filter((result) => !applying.some((declaration) => matches(declaration, result))).sort(byPlace),
    stale: applying.filter((declaration) => !skipped.some((result) => matches(declaration, result))),
    unjudged: declarations.length - applying.length,
  };
}

function refusedStale(verdict: Verdict): readonly SkipDeclaration[] {
  return verdict.environment === "ci" ? verdict.stale : [];
}

export function passes(verdict: Verdict): boolean {
  return verdict.undeclared.length === 0 && refusedStale(verdict).length === 0;
}

function staleLine(declaration: SkipDeclaration): string {
  return `  ${declaration.file}:${declaration.line}: no test skipped with this declaration; reason: ${declaration.reason}`;
}

function verdictLines(verdict: Verdict): readonly string[] {
  const { environment, skipped, undeclared, unjudged } = verdict;
  const run = `this ${environment} run`;
  if (passes(verdict)) {
    const other = environment === "ci" ? "local" : "ci";
    const aside = unjudged === 0 ? "" : `; ${unjudged} declaration(s) for ${other} not judged in ${run}`;
    return [skipped === 0 ? `${NAME}: no test skipped${aside}` : `${NAME}: ${skipped} skipped test(s), each declared at its test site${aside}`];
  }
  const stale = refusedStale(verdict);
  const counted = environment === "ci" ? ` and ${stale.length} declaration(s) matching no skipped test` : "";
  return [
    `${NAME}: ${undeclared.length} skipped test(s) undeclared${counted} in ${run}:`,
    ...undeclared.map((result) => {
      const [kind, usage] =
        result.outcome === "todo"
          ? ["a todo", "test.todo(skipReason(reason, name))"]
          : ["skipped", "test.skipIf(condition)(skipReason(reason, name), fn)"];
      return `  ${result.file}:${result.line} ${result.name}: ${kind} with no reason at its test site; use ${usage}`;
    }),
    ...stale.map(staleLine),
  ];
}

export function report(verdict: Verdict): string {
  const warned = verdict.environment === "local" ? verdict.stale : [];
  const warning =
    warned.length === 0
      ? []
      : [
          `${NAME}: warning: ${warned.length} declaration(s) matching no skipped test in this local run, refused only in a ci run:`,
          ...warned.map(staleLine),
        ];
  return [...verdictLines(verdict), ...warning].join("\n");
}

const environmentOf = Config.Boolean("CI").pipe(
  Config.withDefault(false),
  Config.map((ci): Environment => (ci ? "ci" : "local")),
  Effect.mapError((cause) => new SkipGateError({ message: `cannot tell a ci run from a local one: ${cause.message}` })),
);

const approvingScreens = Config.Boolean(APPROVE_VARIABLE).pipe(
  Config.withDefault(false),
  Effect.mapError((cause) => new SkipGateError({ message: `cannot read ${APPROVE_VARIABLE}: ${cause.message}` })),
);

export function selectSuite(options: TestOptions, environment: Environment): SuiteSelection {
  if (options.tier !== undefined) return { kind: "tier", tier: options.tier };
  if (options.full === true || environment === "ci") return { kind: "full" };
  return { kind: "smoke" };
}

const FIRST_WORKER_BYTES = 1024 ** 3;
const EXTRA_WORKER_BYTES = 100 * 1024 * 1024;
const MEMORY_RESERVE_FRACTION = 0.1;

export function workerCountFor(freeBytes: number, totalBytes: number, cpus: number): number {
  const usable = freeBytes - MEMORY_RESERVE_FRACTION * totalBytes - FIRST_WORKER_BYTES;
  return Math.max(1, Math.min(cpus, Math.floor(usable / EXTRA_WORKER_BYTES) + 1));
}

export function reclaimableBytes(vmStat: string): number | undefined {
  const pageSize = /page size of (\d+) bytes/.exec(vmStat)?.[1];
  if (pageSize === undefined) return undefined;
  let pages = 0;
  for (const label of ["free", "inactive", "speculative"]) {
    const count = new RegExp(`Pages ${label}:\\s+(\\d+)\\.`).exec(vmStat)?.[1];
    if (count === undefined) return undefined;
    pages += Number(count);
  }
  return pages * Number(pageSize);
}

const availableBytes = Effect.fn("availableBytes")(function* () {
  if (process.platform !== "darwin") return freemem();
  const vmStat = yield* collect("vm_stat", []).pipe(
    Effect.map(({ stdout }) => stdout),
    Effect.orElseSucceed(() => ""),
  );
  return reclaimableBytes(vmStat) ?? freemem();
});

export const resolveWorkerCount = Effect.fn("resolveWorkerCount")(function* (workers: number | undefined) {
  if (workers !== undefined) return workers;
  const cores = yield* ciCores;
  if (Option.isSome(cores)) return cores.value;
  return workerCountFor(yield* availableBytes(), totalmem(), availableParallelism());
});

// A live or pixel tier and --full run whole, since no pull request picks them.
export function narrowedTier(options: TestOptions, selection: SuiteSelection): { readonly tier: TestTier | undefined } | undefined {
  if (options.full === true) return undefined;
  if (selection.kind === "full") return { tier: undefined };
  if (selection.kind === "tier" && (selection.tier === "unit" || selection.tier === "e2e")) return { tier: selection.tier };
  return undefined;
}

// Returns undefined when a shared file widens the run, so the caller keeps the selection it already had.
const reachedSelection = Effect.fn("reachedSelection")(function* (changed: readonly string[], tier: TestTier | undefined, base?: string) {
  const tests = (yield* scanTestFiles(process.cwd())).filter((file) => selectedTierFile(file, tier));
  const narrowing = yield* readChangedNarrowing(process.cwd(), changed, tests, tier, base);
  if (narrowing.kind === "full") {
    yield* Console.log(`${NAME}: ${narrowing.because}, so ${tier === undefined ? "the whole suite" : `the ${tier} tier`} runs`);
    return undefined;
  }
  yield* Console.log(`${NAME}: the pull request reaches ${narrowing.files.length} of ${tests.length} test file(s)`);
  return { kind: "files", files: narrowing.files, ...(tier === "pixel" ? { tier } : {}) } satisfies SuiteSelection;
});

const narrowSelection = Effect.fn("narrowSelection")(function* (options: TestOptions, selection: SuiteSelection, environment: Environment) {
  const narrowed = narrowedTier(options, selection);
  if (environment !== "ci" || narrowed === undefined) return selection;
  const scope = yield* readRunScope(process.cwd());
  if (scope.kind === "whole") {
    yield* Console.log(`${NAME}: ${scope.because}, so the whole suite runs`);
    return selection;
  }
  return (yield* reachedSelection(scope.changed, narrowed.tier, scope.kind === "pull-request" ? scope.ends?.base : undefined)) ?? selection;
});

const changedSelection = Effect.fn("changedSelection")(function* () {
  const changed = yield* changedLocalPaths(process.cwd());
  const tests = (yield* scanTestFiles(process.cwd())).filter((file) => selectedTierFile(file, undefined));
  const narrowing = yield* readLocalNarrowing(process.cwd(), changed, tests);
  if (narrowing.kind === "full") {
    yield* Console.log(`${NAME}: ${narrowing.because}, so the whole suite runs`);
    return { kind: "changed", files: tests } satisfies SuiteSelection;
  }
  for (const { path, reason } of narrowing.shared) {
    yield* Console.log(`${NAME}: the change touches ${path}, ${reason}, so the whole suite is left to the pull request`);
  }
  if (narrowing.files.length > 0) yield* Console.log(`${NAME}: the change reaches ${narrowing.files.length} of ${tests.length} test file(s): ${narrowing.files.join(" ")}`);
  return { kind: "changed", files: narrowing.files } satisfies SuiteSelection;
});

const pullRequestSelection = Effect.fn("pullRequestSelection")(function* (tier: TestTier | undefined) {
  const scope = yield* readRunScope(process.cwd());
  if (scope.kind === "whole") {
    yield* Console.log(`${NAME}: ${scope.because}, so ${tier === undefined ? "the whole suite" : `the ${tier} tier`} runs`);
    return tier === undefined ? ({ kind: "full" } satisfies SuiteSelection) : ({ kind: "tier", tier } satisfies SuiteSelection);
  }
  if (scope.kind === "docs-only") {
    return { kind: "files", files: [] } satisfies SuiteSelection;
  }
  return (yield* reachedSelection(scope.changed, tier, scope.ends?.base)) ?? (tier === undefined ? ({ kind: "full" } satisfies SuiteSelection) : ({ kind: "tier", tier } satisfies SuiteSelection));
});

const entrySelection = Effect.fn("entrySelection")(function* (run: EntryRun, options: TestOptions, environment: Environment) {
  if (run === "changed") return yield* changedSelection();
  if (run === "pr" || run === "pr-screens") return yield* pullRequestSelection(run === "pr-screens" ? "pixel" : options.tier);
  return yield* narrowSelection(options, selectSuite(options, environment), environment);
});

const runSuite = Effect.fn("runSuite")(function* (outfile: string, args: readonly string[], workers: number | undefined) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ["test", "--pass-with-no-tests", "--randomize", `--parallel=${yield* resolveWorkerCount(workers)}`, ...args, ...reporterArgs(outfile)];
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, command, {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: { CI: "true" },
      extendEnv: true,
    }),
  );
});

type RunPolicy = { readonly environment: "local" } | { readonly environment: "ci"; readonly maxFileSeconds: number };

const temporaryReportPath = Effect.fn("temporaryReportPath")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return path.join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-" }), "junit.xml");
});

function emptySelectionMessage(selection: SuiteSelection): string | undefined {
  if (selection.kind === "files" && selection.files.length === 0) return "no selected test file, so no test ran";
  if (selection.kind === "changed" && selection.files.length === 0) return "the change reaches no test file, so no test ran";
  return undefined;
}

const shardingOf = Effect.fn("shardingOf")(function* (shard: Shard | undefined, configured: unknown) {
  if (shard === undefined) return undefined;
  const timings = configured === undefined ? {} : yield* decodeSetting("testFileTimings", TestFileTimings, configured);
  return { shard, timings };
});

const testEntry = Effect.gen(function* () {
  const root = process.cwd();
  yield* refuseLocalTests(root);
  const entry = entryOptions(process.argv.slice(2));
  if (entry === undefined) return yield* new Usage({ message: USAGE });
  const { options, junit, run, shard } = entry;
  const environment = yield* environmentOf;
  yield* refuseOldPlace(root, "smoke", { manifestKey: "smoke" });
  yield* refuseOldPlace(root, "reach", { manifestKey: "reach" });
  const refusal = run === "pr" || run === "pr-screens"
    ? pullRequestRunRefusal(environment, run === "pr-screens" ? "--pr-screens" : "--pr")
    : heavyRunRefusal(options, environment, options.tier === "pixel" && (yield* approvingScreens));
  if (refusal !== undefined) return yield* new RunRefusal({ message: refusal });
  const settings = yield* loadSettings(root);
  const policy: RunPolicy = environment === "ci"
    ? { environment, maxFileSeconds: yield* resolveTestFileMaxSeconds(settings["testFileMaxSeconds"]) }
    : { environment };
  const excluded = yield* readTestFileSkips(root, settings["testFileSkips"]);
  const selection = yield* entrySelection(run, options, environment);
  const nothingSelected = emptySelectionMessage(selection);
  if (nothingSelected !== undefined) {
    yield* Console.log(`${NAME}: ${nothingSelected}`);
    return true;
  }
  const configuredSmoke = settings["smoke"];
  const smoke = selection.kind === "smoke" && configuredSmoke !== undefined ? yield* decodeSetting("smoke", Smoke, configuredSmoke) : [];
  const sharding = yield* shardingOf(shard, settings["testFileTimings"]);
  const scope = yield* readSuiteScope(root, selection, smoke, excluded, sharding);
  if (scope.kind === "empty") {
    yield* Console.log(`${NAME}: ${scope.message}`);
    return true;
  }

  const outfile = yield* temporaryReportPath();
  const suitePassed = (yield* runSuite(outfile, scope.args, options.workers)) === ChildProcessSpawner.ExitCode(0);
  return yield* judgeRun(outfile, junit, suitePassed, scope.declarations, policy);
}).pipe(Effect.scoped);

const judgeRun = Effect.fn("judgeRun")(function* (
  outfile: string,
  junit: Option.Option<string>,
  suitePassed: boolean,
  declarations: Parameters<typeof judgeSkips>[1],
  policy: RunPolicy,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const written = yield* fs.exists(outfile);
  if (written && Option.isSome(junit)) {
    yield* fs.makeDirectory(path.dirname(junit.value), { recursive: true });
    yield* fs.copyFile(outfile, junit.value);
  }
  if (!written) {
    if (!suitePassed) {
      yield* Console.error(`${NAME}: bun test failed before it wrote a report, so no skip was judged`);
      return false;
    }
    if ((yield* scanTestFiles(process.cwd())).length > 0) {
      return yield* new ReportError({ message: `bun test passed but wrote no report to ${outfile}` });
    }
    yield* Console.log(`${NAME}: no test file found`);
    return true;
  }

  const xml = yield* fs.readFileString(outfile);
  const { results, crashedFiles } = yield* parseReport(xml);
  const timings = [...(yield* fileSeconds(xml))].filter(([, seconds]) => seconds > 0);
  yield* Console.log(`${NAME}: testFileTimings ${JSON.stringify(Object.fromEntries(timings))}`);
  for (const file of crashedFiles) yield* Console.error(`${NAME}: the worker running ${file} crashed, so its skips were not judged`);
  const judged = declarations.filter((declaration) => !crashedFiles.includes(declaration.file));
  const verdict = judgeSkips(results, judged, policy.environment);
  yield* passes(verdict) ? Console.log(report(verdict)) : Console.error(report(verdict));
  const withinFileLimit = policy.environment === "local" || (yield* judgeTestFileTimes(xml, policy.maxFileSeconds));
  return suitePassed && crashedFiles.length === 0 && passes(verdict) && withinFileLimit;
});

if (import.meta.main) runMain(NAME, testEntry);
