#!/usr/bin/env bun
import { availableParallelism } from "node:os";
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { runMain, Usage } from "../core/main.ts";
import { readSkipDeclarations, type Environment, type SkipDeclaration, type TestTier } from "./test-skips.ts";
import { NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

export type { Environment, SkipDeclaration } from "./test-skips.ts";

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

export type TestOptions = {
  readonly tier?: TestTier;
  readonly workers?: number;
};

const NAME = TEST_ENTRY_POINT.bin;
const USAGE = `usage: ${NAME} [--tier=live | --tier=pixel | --tier=unit | --tier=e2e] [--parallel=<workers>] [--junit=<file>], and it refuses test filters`;
const TIERS = new Map<string, TestTier>([
  ["--tier=live", "live"],
  ["--tier=pixel", "pixel"],
  ["--tier=unit", "unit"],
  ["--tier=e2e", "e2e"],
]);
const PARALLEL = /^--parallel=([1-9][0-9]*)$/;
const JUNIT = /^--junit=(.+)$/;

function optionOf(arg: string): TestOptions | undefined {
  const tier = TIERS.get(arg);
  if (tier !== undefined) return { tier };
  const workers = PARALLEL.exec(arg)?.[1];
  return workers === undefined ? undefined : { workers: Number(workers) };
}

export function testOptions(args: readonly string[]): TestOptions | undefined {
  let options: TestOptions = {};
  for (const arg of args) {
    const option = optionOf(arg);
    if (option === undefined || Object.keys(option).some((key) => key in options)) return undefined;
    options = { ...options, ...option };
  }
  return options;
}

export type EntryOptions = { readonly options: TestOptions; readonly junit: Option.Option<string> };

// Kept out of testOptions, so checks-test-layout still holds a package.json test script to --parallel alone.
export function entryOptions(args: readonly string[]): EntryOptions | undefined {
  const junit = args.flatMap((arg) => JUNIT.exec(arg)?.[1] ?? []);
  const options = testOptions(args.filter((arg) => !JUNIT.test(arg)));
  if (options === undefined || junit.length > 1) return undefined;
  return { options, junit: Option.fromNullishOr(junit[0]) };
}

const TEST_SCRIPTS: readonly string[] = [NAME, `bun src/${TEST_ENTRY_POINT.script}`];

export function scriptOptions(script: unknown): TestOptions | undefined {
  if (typeof script !== "string") return undefined;
  const entry = TEST_SCRIPTS.find((candidate) => script === candidate || script.startsWith(`${candidate} `));
  return entry === undefined ? undefined : testOptions(script.slice(entry.length).split(" ").filter((arg) => arg !== ""));
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

function tierArgs(tier: TestTier | undefined): readonly string[] {
  if (tier === undefined) return [];
  // The preset ignores tests/live and tests/pixel, so only those tiers clear the ignore list.
  if (tier === "live" || tier === "pixel") return ["--path-ignore-patterns", "", `./tests/${tier}`];
  return [`./tests/${tier}`];
}

export function workerCount(workers: number | undefined): number {
  return workers ?? availableParallelism();
}

const runSuite = Effect.fn("runSuite")(function* (outfile: string, { tier, workers }: TestOptions) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", "--randomize", `--parallel=${workerCount(workers)}`, ...tierArgs(tier), ...reporterArgs(outfile)];
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, args, {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: { CI: "true" },
      extendEnv: true,
    }),
  );
});

const testEntry = Effect.gen(function* () {
  const entry = entryOptions(process.argv.slice(2));
  if (entry === undefined) return yield* new Usage({ message: USAGE });
  const { options, junit } = entry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const declarations = yield* readSkipDeclarations(process.cwd(), options.tier);
  const environment = yield* environmentOf;

  const outfile = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-" }), "junit.xml");
  const suitePassed = (yield* runSuite(outfile, options)) === ChildProcessSpawner.ExitCode(0);
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
    return yield* new ReportError({ message: `bun test passed but wrote no report to ${outfile}` });
  }

  const { results, crashedFiles } = yield* parseReport(yield* fs.readFileString(outfile));
  for (const file of crashedFiles) yield* Console.error(`${NAME}: the worker running ${file} crashed, so its skips were not judged`);
  const judged = declarations.filter((declaration) => !crashedFiles.includes(declaration.file));
  const verdict = judgeSkips(results, judged, environment);
  yield* passes(verdict) ? Console.log(report(verdict)) : Console.error(report(verdict));
  return suitePassed && crashedFiles.length === 0 && passes(verdict);
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, testEntry);
