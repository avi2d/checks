#!/usr/bin/env bun
import { availableParallelism } from "node:os";
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { runMain, Usage } from "../core/main.ts";
import { FULL, testOptions, type TestOptions, type TestTier } from "../core/test-script.ts";
import { readPullRequestNarrowing } from "./affected-tests.ts";
import { changedE2eFiles } from "./changed-tests.ts";
import {
  readDeclarationsIn,
  readSkipDeclarations,
  readSmokeDeclarations,
  scanTestFiles,
  selectedTierFile,
  unitTierPlus,
  type Environment,
  type SkipDeclaration,
} from "./test-skips.ts";
import { NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

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

const NAME = TEST_ENTRY_POINT.bin;
const USAGE = `usage: ${NAME} [--tier=live | --tier=pixel | --tier=unit | --tier=e2e | --full | --changed] [--parallel=<workers>] [--junit=<file>], and it refuses test filters`;
const CHANGED = "--changed";
const JUNIT = /^--junit=(.+)$/;

export type EntryOptions = {
  readonly options: TestOptions;
  readonly junit: Option.Option<string>;
  readonly changed: boolean;
};

// Kept out of testOptions, so checks-test-layout still holds a package.json test script to --parallel alone.
export function entryOptions(args: readonly string[]): EntryOptions | undefined {
  const junit = args.flatMap((arg) => JUNIT.exec(arg)?.[1] ?? []);
  const changed = args.filter((arg) => arg === CHANGED).length;
  const options = testOptions(args.filter((arg) => !JUNIT.test(arg) && arg !== CHANGED));
  if (options === undefined || junit.length > 1 || changed > 1) return undefined;
  if (changed === 1 && (options.tier !== undefined || options.full === true)) return undefined;
  return { options, junit: Option.fromNullishOr(junit[0]), changed: changed === 1 };
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

export type SuiteSelection =
  | { readonly kind: "full" }
  | { readonly kind: "tier"; readonly tier: TestTier }
  | { readonly kind: "smoke" }
  | { readonly kind: "files"; readonly files: readonly string[] }
  | { readonly kind: "changed"; readonly e2e: readonly string[] };

export function selectSuite(options: TestOptions, environment: Environment): SuiteSelection {
  if (options.tier !== undefined) return { kind: "tier", tier: options.tier };
  if (options.full === true || environment === "ci") return { kind: "full" };
  return { kind: "smoke" };
}

const SmokeManifest = Schema.Struct({
  checks: Schema.optional(Schema.Struct({ smoke: Schema.optional(Schema.Array(Schema.NonEmptyString)) })),
});

export function smokeList(manifest: unknown): readonly string[] | undefined {
  if (!Schema.is(SmokeManifest)(manifest)) return undefined;
  return manifest.checks?.smoke ?? [];
}

export function suiteArgs(selection: SuiteSelection, smoke: readonly string[]): readonly string[] {
  if (selection.kind === "tier") return tierArgs(selection.tier);
  if (selection.kind === "changed") return suiteArgs({ kind: "smoke" }, selection.e2e);
  if (selection.kind === "smoke") return ["./tests/unit", ...smoke.map((file) => `./${file}`)];
  if (selection.kind === "files") return selection.files.map((file) => `./${file}`);
  return [];
}

function tierArgs(tier: TestTier | undefined): readonly string[] {
  if (tier === undefined) return [];
  // The preset ignores tests/live and tests/pixel, so only those tiers clear the ignore list.
  if (tier === "live" || tier === "pixel") return ["--path-ignore-patterns", "", `./tests/${tier}`];
  return [`./tests/${tier}`];
}

export function workerCount(workers: number | undefined): number {
  return workers ?? availableParallelism();
}

const readSmokeList = Effect.fn("readSmokeList")(function* (root: string) {
  const file = (yield* Path.Path).join(root, "package.json");
  const text = yield* (yield* FileSystem.FileSystem).readFileString(file);
  const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
    Effect.mapError((cause) => new SkipGateError({ message: "cannot read " + file + " as JSON: " + cause.message })),
  );
  const smoke = smokeList(manifest);
  if (smoke === undefined) {
    return yield* new SkipGateError({ message: file + ": checks.smoke must be an array of test file paths" });
  }
  return smoke;
});

// A live or pixel tier and --full run whole, since no pull request picks them.
export function narrowedTier(options: TestOptions, selection: SuiteSelection): { readonly tier: TestTier | undefined } | undefined {
  if (options.full === true) return undefined;
  if (selection.kind === "full") return { tier: undefined };
  if (selection.kind === "tier" && (selection.tier === "unit" || selection.tier === "e2e")) return { tier: selection.tier };
  return undefined;
}

const narrowSelection = Effect.fn("narrowSelection")(function* (options: TestOptions, selection: SuiteSelection, environment: Environment) {
  const narrowed = narrowedTier(options, selection);
  if (environment !== "ci" || narrowed === undefined) return selection;
  const tests = (yield* scanTestFiles(process.cwd())).filter((file) => selectedTierFile(file, narrowed.tier));
  const narrowing = yield* readPullRequestNarrowing(process.cwd(), tests);
  if (Option.isNone(narrowing)) return selection;
  if (narrowing.value.kind === "full") {
    yield* Console.log(`${NAME}: ${narrowing.value.because}, so the whole suite runs`);
    return selection;
  }
  yield* Console.log(`${NAME}: the pull request reaches ${narrowing.value.files.length} of ${tests.length} test file(s)`);
  return { kind: "files", files: narrowing.value.files } satisfies SuiteSelection;
});

const readScope = Effect.fn("readScope")(function* (selection: SuiteSelection, smoke: readonly string[]) {
  if (selection.kind === "smoke") return yield* readSmokeDeclarations(process.cwd(), smoke);
  if (selection.kind === "changed") {
    const files = unitTierPlus(yield* scanTestFiles(process.cwd()), selection.e2e);
    return { files, declarations: yield* readDeclarationsIn(process.cwd(), files) };
  }
  const declarations =
    selection.kind === "files"
      ? yield* readDeclarationsIn(process.cwd(), selection.files)
      : yield* readSkipDeclarations(process.cwd(), selection.kind === "tier" ? selection.tier : undefined);
  return { files: undefined, declarations };
});

const changedSelection = Effect.fn("changedSelection")(function* () {
  const e2e = yield* changedE2eFiles(process.cwd());
  yield* Console.log(
    e2e.length === 0
      ? `${NAME}: the change touches no e2e test files, so only the unit tier runs`
      : `${NAME}: the change touches ${e2e.length} e2e test file(s): ${e2e.join(" ")}`,
  );
  return { kind: "changed", e2e } satisfies SuiteSelection;
});

const runSuite = Effect.fn("runSuite")(function* (outfile: string, args: readonly string[], workers: number | undefined) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ["test", "--randomize", `--parallel=${workerCount(workers)}`, ...args, ...reporterArgs(outfile)];
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

const testEntry = Effect.gen(function* () {
  const entry = entryOptions(process.argv.slice(2));
  if (entry === undefined) return yield* new Usage({ message: USAGE });
  const { options, junit, changed } = entry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* environmentOf;
  const selection = changed
    ? yield* changedSelection()
    : yield* narrowSelection(options, selectSuite(options, environment), environment);
  if (selection.kind === "files" && selection.files.length === 0) {
    yield* Console.log(`${NAME}: the pull request changes no file a test reads, so no test ran`);
    return true;
  }
  const smoke = selection.kind === "smoke" ? yield* readSmokeList(process.cwd()) : [];
  const scope = yield* readScope(selection, smoke);
  if (scope.files?.length === 0 && selection.kind === "changed") {
    yield* Console.log(`${NAME}: no unit test and no e2e test the change touches, so no test ran`);
    return true;
  }
  if (scope.files?.length === 0) {
    yield* Console.log(`${NAME}: no unit test and no smoke list, so this local run ran nothing; declare checks.smoke or pass ${FULL}`);
    return true;
  }
  const { declarations } = scope;

  const outfile = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-" }), "junit.xml");
  const suitePassed =
    (yield* runSuite(outfile, suiteArgs(selection, smoke), options.workers)) === ChildProcessSpawner.ExitCode(0);
  return yield* judgeRun(outfile, junit, suitePassed, declarations, environment);
}).pipe(Effect.scoped);

const judgeRun = Effect.fn("judgeRun")(function* (
  outfile: string,
  junit: Option.Option<string>,
  suitePassed: boolean,
  declarations: Parameters<typeof judgeSkips>[1],
  environment: Environment,
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
    return yield* new ReportError({ message: `bun test passed but wrote no report to ${outfile}` });
  }

  const { results, crashedFiles } = yield* parseReport(yield* fs.readFileString(outfile));
  for (const file of crashedFiles) yield* Console.error(`${NAME}: the worker running ${file} crashed, so its skips were not judged`);
  const judged = declarations.filter((declaration) => !crashedFiles.includes(declaration.file));
  const verdict = judgeSkips(results, judged, environment);
  yield* passes(verdict) ? Console.log(report(verdict)) : Console.error(report(verdict));
  return suitePassed && crashedFiles.length === 0 && passes(verdict);
});

if (import.meta.main) runMain(NAME, testEntry);
