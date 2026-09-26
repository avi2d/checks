#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { TEST_ENTRY_POINT } from "./gates.ts";
import { runMain, Usage } from "./main.ts";
import {
  readSkipDeclarations,
  stripInlineSkip,
  type Environment,
  type SkipDeclaration,
  type TestTier,
} from "./test-skips.ts";
import { parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

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

const NAME = TEST_ENTRY_POINT.bin;
const USAGE = `usage: ${NAME} takes no arguments except --tier=live or --tier=pixel`;
const TIERS = new Map<string, TestTier>([
  ["--tier=live", "live"],
  ["--tier=pixel", "pixel"],
]);

function matches(declaration: SkipDeclaration, result: TestResult): boolean {
  return declaration.file === result.file && declaration.line === result.line;
}

function declaredAtSite(declaration: SkipDeclaration, result: TestResult): boolean {
  return matches(declaration, result) && stripInlineSkip(result.name) !== undefined;
}

function byPlace(a: TestResult, b: TestResult): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name);
}

export function judgeSkips(
  results: readonly TestResult[],
  declarations: readonly SkipDeclaration[],
  environment: Environment,
): Verdict {
  const skipped = results.filter((result) => result.outcome === "skipped" || result.outcome === "todo");
  const applying = declarations.filter((declaration) => (declaration.when ?? environment) === environment);
  return {
    environment,
    skipped: skipped.length,
    undeclared: skipped
      .filter((result) => !applying.some((declaration) => declaredAtSite(declaration, result)) || result.outcome === "todo")
      .sort(byPlace),
    stale: applying.filter(
      (declaration) => !results.some((result) => declaredAtSite(declaration, result) && result.outcome === "skipped"),
    ),
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
      const name = stripInlineSkip(result.name) ?? result.name;
      if (result.outcome === "todo") {
        return `  ${result.file}:${result.line} ${name}: a todo is not allowed; implement it or remove test.todo`;
      }
      return `  ${result.file}:${result.line} ${name}: skipped with no reason at its test site; use test.skipIf(condition)(skipReason(reason, name), fn)`;
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

const runSuite = Effect.fn("runSuite")(function* (outfile: string, tier: TestTier | undefined) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const tierArgs = tier === undefined ? [] : ["--path-ignore-patterns", "", `tests/${tier}`];
  const args = ["test", "--randomize", ...tierArgs, ...reporterArgs(outfile)];
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, args, { stdin: "ignore", stdout: "inherit", stderr: "inherit" }),
  );
});

const testEntry = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const tier = args.length === 0 ? undefined : args.length === 1 ? TIERS.get(args[0] ?? "") : undefined;
  if (args.length > 0 && tier === undefined) return yield* new Usage({ message: USAGE });
  const fs = yield* FileSystem.FileSystem;
  const declarations = yield* readSkipDeclarations(process.cwd(), tier);
  const environment = yield* environmentOf;

  const outfile = (yield* Path.Path).join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-" }), "junit.xml");
  const suitePassed = (yield* runSuite(outfile, tier)) === ChildProcessSpawner.ExitCode(0);
  if (!(yield* fs.exists(outfile))) {
    if (!suitePassed) {
      yield* Console.error(`${NAME}: bun test failed before it wrote a report, so no skip was judged`);
      return false;
    }
    return yield* new ReportError({ message: `bun test passed but wrote no report to ${outfile}` });
  }

  const verdict = judgeSkips(yield* parseReport(yield* fs.readFileString(outfile)), declarations, environment);
  yield* passes(verdict) ? Console.log(report(verdict)) : Console.error(report(verdict));
  return suitePassed && passes(verdict);
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, testEntry);
