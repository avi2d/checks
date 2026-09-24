#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { TEST_ENTRY_POINT } from "./gates.ts";
import { runMain, Usage } from "./main.ts";
import { NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

const Environment = Schema.Literals(["ci", "local"]);

export type Environment = typeof Environment.Type;

const SkipDeclaration = Schema.Struct({
  file: Schema.NonEmptyString,
  test: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  when: Schema.optionalKey(Environment),
});

export type SkipDeclaration = typeof SkipDeclaration.Type;

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
const DECLARATIONS = "package.json testSkips";
const USAGE = `usage: ${NAME} takes no arguments, since a narrowed run skips every test it leaves out; run bun test --randomize <args> for one`;

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ testSkips: Schema.optionalKey(Schema.Array(SkipDeclaration)) })),
);

function matches(declaration: SkipDeclaration, result: TestResult): boolean {
  return declaration.file === result.file && declaration.test === result.name;
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
    undeclared: skipped.filter((result) => !applying.some((declaration) => matches(declaration, result))).sort(byPlace),
    stale: applying.filter((declaration) => !skipped.some((result) => matches(declaration, result))),
    unjudged: declarations.length - applying.length,
  };
}

export function passes(verdict: Verdict): boolean {
  return verdict.undeclared.length === 0 && verdict.stale.length === 0;
}

export function report(verdict: Verdict): string {
  const { environment, skipped, undeclared, stale, unjudged } = verdict;
  const run = `this ${environment} run`;
  if (passes(verdict)) {
    const other = environment === "ci" ? "local" : "ci";
    const aside = unjudged === 0 ? "" : `; ${unjudged} declaration(s) for ${other} not judged in ${run}`;
    return skipped === 0 ? `${NAME}: no test skipped${aside}` : `${NAME}: ${skipped} skipped test(s), each declared in ${DECLARATIONS}${aside}`;
  }
  return [
    `${NAME}: ${undeclared.length} skipped test(s) undeclared and ${stale.length} declaration(s) matching no skipped test in ${run}:`,
    ...undeclared.map((result) => {
      const kind = result.outcome === "todo" ? "a todo" : "skipped";
      return `  ${result.file}:${result.line} ${result.name}: ${kind} with no declaration; run it, or declare it in ${DECLARATIONS} with its reason`;
    }),
    ...stale.map(
      (declaration) =>
        `  ${declaration.file}${NAME_SEPARATOR}${declaration.test}: declared, but no such test skipped; delete the declaration`,
    ),
  ].join("\n");
}

const readDeclarations = Effect.fn("readDeclarations")(function* (root: string) {
  const manifest = (yield* Path.Path).join(root, "package.json");
  const { testSkips } = yield* (yield* FileSystem.FileSystem).readFileString(manifest).pipe(
    Effect.flatMap(decodeManifest),
    Effect.mapError((cause) => new SkipGateError({ message: `cannot read ${DECLARATIONS}: ${cause.message}` })),
  );
  return testSkips ?? [];
});

const environmentOf = Config.Boolean("CI").pipe(
  Config.withDefault(false),
  Config.map((ci): Environment => (ci ? "ci" : "local")),
  Effect.mapError((cause) => new SkipGateError({ message: `cannot tell a ci run from a local one: ${cause.message}` })),
);

const runSuite = Effect.fn("runSuite")(function* (outfile: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", "--randomize", ...reporterArgs(outfile)];
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, args, { stdin: "ignore", stdout: "inherit", stderr: "inherit" }),
  );
});

const testEntry = Effect.gen(function* () {
  if (process.argv.length > 2) return yield* new Usage({ message: USAGE });
  const fs = yield* FileSystem.FileSystem;
  const declarations = yield* readDeclarations(process.cwd());
  const environment = yield* environmentOf;

  const outfile = (yield* Path.Path).join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-" }), "junit.xml");
  const suitePassed = (yield* runSuite(outfile)) === ChildProcessSpawner.ExitCode(0);
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
