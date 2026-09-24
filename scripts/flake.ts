#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Random, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { runMain, Usage } from "./main.ts";
import { NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";

export type Run = {
  readonly seed: number;
  readonly passed: boolean;
  readonly tests: number;
  readonly failed: readonly TestResult[];
};

export type Failure = {
  readonly file: string;
  readonly test: string;
  readonly line: number;
  readonly seeds: readonly number[];
};

export type RunRecord = Omit<Run, "failed"> & { readonly failed: readonly string[] };

export type FlakeRecord = {
  readonly runs: readonly RunRecord[];
  readonly failures: readonly Failure[];
  readonly outsideTests: readonly number[];
};

type Plan = { readonly seeds: readonly number[] } | { readonly runs: number };

const NAME = "checks-flake";
const USAGE = `usage: ${NAME} [--runs <count> | --seed <seed>...] [--report <file>]`;
const DEFAULT_RUNS = 10;
const MAX_SEED = 2 ** 32 - 1;

const wholeBetween = (minimum: number, maximum: number) =>
  Schema.decodeUnknownEffect(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum, maximum })));
const decodeRuns = wholeBetween(1, 1000);
const decodeSeed = wholeBetween(0, MAX_SEED);

const parseArgs = Effect.fnUntraced(function* (args: readonly string[]) {
  const usage = (reason?: string) => new Usage({ message: reason === undefined ? USAGE : `${reason}; ${USAGE}` });
  let runs: string | undefined;
  let report: string | undefined;
  const seeds: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (value === undefined) return yield* usage();
    if (flag === "--runs" && runs === undefined) runs = value;
    else if (flag === "--seed") seeds.push(value);
    else if (flag === "--report" && report === undefined) report = value;
    else return yield* usage();
  }
  if (runs !== undefined && seeds.length > 0) return yield* usage();
  const invalid = (flag: string) => (cause: { readonly message: string }) => usage(`${flag}: ${cause.message}`);
  const plan: Plan =
    seeds.length > 0
      ? { seeds: yield* Effect.forEach(seeds, (seed) => decodeSeed(seed).pipe(Effect.mapError(invalid("--seed")))) }
      : { runs: runs === undefined ? DEFAULT_RUNS : yield* decodeRuns(runs).pipe(Effect.mapError(invalid("--runs"))) };
  return { plan, report };
});

const seedsOf = (plan: Plan) =>
  "seeds" in plan ? Effect.succeed(plan.seeds) : Effect.replicateEffect(Random.nextIntBetween(0, MAX_SEED), plan.runs);

const runOnce = Effect.fn("runOnce")(function* (seed: number, outfile: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", "--randomize", `--seed=${seed}`, ...reporterArgs(outfile)];
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(process.execPath, args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
  );
  const passed = exitCode === ChildProcessSpawner.ExitCode(0);
  if (!(yield* fs.exists(outfile))) {
    if (passed) return yield* new ReportError({ message: `bun test passed with seed ${seed} but wrote no report` });
    return { seed, passed, tests: 0, failed: [] } satisfies Run;
  }
  const results = yield* parseReport(yield* fs.readFileString(outfile));
  return { seed, passed, tests: results.length, failed: results.filter((result) => result.outcome === "failed") } satisfies Run;
});

function outcomeOf(run: Run): string {
  if (run.passed) return "passed";
  return run.failed.length === 0 ? "failed outside any test" : `failed, ${run.failed.length} test(s) failing`;
}

function nameOf(result: TestResult): string {
  return `${result.file}${NAME_SEPARATOR}${result.name}`;
}

export function recordOf(runs: readonly Run[]): FlakeRecord {
  const failures = new Map<string, { file: string; test: string; line: number; seeds: number[] }>();
  for (const run of runs) {
    for (const result of run.failed) {
      const failure = failures.get(nameOf(result)) ?? { file: result.file, test: result.name, line: result.line, seeds: [] };
      if (!failure.seeds.includes(run.seed)) failure.seeds.push(run.seed);
      failures.set(nameOf(result), failure);
    }
  }
  return {
    runs: runs.map(({ seed, passed, tests, failed }) => ({ seed, passed, tests, failed: failed.map(nameOf) })),
    failures: [...failures.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    outsideTests: runs.filter((run) => !run.passed && run.failed.length === 0).map((run) => run.seed),
  };
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

export function summary(record: FlakeRecord): string {
  const total = record.runs.length;
  const failedRuns = record.runs.filter((run) => !run.passed).length;
  if (failedRuns === 0) return `${NAME}: ${total} run(s) passed, with seeds ${record.runs.map((run) => run.seed).join(", ")}`;
  const lines = [`${NAME}: ${failedRuns} of ${total} run(s) failed, ${record.failures.length} test(s) failing in them`];
  if (record.failures.length > 0) {
    lines.push("", "| Test | Failed | Seeds |", "| --- | --- | --- |");
    for (const failure of record.failures) {
      const place = cell(`${failure.file}:${failure.line} ${failure.test}`);
      lines.push(`| ${place} | ${failure.seeds.length} of ${total} runs | ${failure.seeds.join(", ")} |`);
    }
  }
  if (record.outsideTests.length > 0) {
    lines.push("", `${record.outsideTests.length} run(s) failed outside any test, with seeds ${record.outsideTests.join(", ")}`);
  }
  lines.push("", "Reproduce a failing run with bun test --randomize --seed=<seed>.");
  return lines.join("\n");
}

const flake = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { plan, report } = yield* parseArgs(process.argv.slice(2));
  const seeds = yield* seedsOf(plan);
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-flake-" });

  const runs = yield* Effect.forEach(seeds, (seed, index) =>
    runOnce(seed, path.join(dir, `${index}.xml`)).pipe(
      Effect.tap((run) => Console.log(`${NAME}: run ${index + 1} of ${seeds.length}, seed ${seed}: ${outcomeOf(run)}`)),
    ),
  );
  const record = recordOf(runs);
  const text = summary(record);
  yield* Console.log(text);

  if (report !== undefined) yield* fs.writeFileString(report, `${JSON.stringify(record, null, 2)}\n`);
  const stepSummary = yield* Config.option(Config.String("GITHUB_STEP_SUMMARY"));
  if (Option.isSome(stepSummary)) yield* fs.writeFileString(stepSummary.value, `${text}\n`, { flag: "a" });
  return runs.every((run) => run.passed);
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, flake);
