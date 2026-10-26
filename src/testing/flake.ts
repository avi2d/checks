#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Random, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { runMain, Usage } from "../core/main.ts";
import { NAME_SEPARATOR, parseReport, ReportError, reporterArgs, type TestResult } from "./test-report.ts";
import { scriptOptions, workerCount } from "./test.ts";

export type Run = {
  readonly seed: number;
  readonly passed: boolean;
  readonly tests: number;
  readonly failed: readonly TestResult[];
  readonly crashedFiles: readonly string[];
  readonly assignment: readonly (readonly string[])[];
};

export type Failure = {
  readonly file: string;
  readonly test: string;
  readonly line: number;
  readonly seeds: readonly number[];
};

export type RunRecord = Omit<Run, "failed" | "crashedFiles" | "assignment"> & { readonly failed: readonly string[] };

export type FailingWorker = { readonly seed: number; readonly files: readonly string[] };

export type Replay = FailingWorker & { readonly command: string };

export type FlakeRecord = {
  readonly runs: readonly RunRecord[];
  readonly failures: readonly Failure[];
  readonly outsideTests: readonly number[];
  readonly parallel?: { readonly workers: number; readonly replays: readonly Replay[] };
};

export class ManifestError extends Schema.TaggedError<ManifestError>()("ManifestError", {
  message: Schema.String,
}) {}

type Plan = { readonly seeds: readonly number[] } | { readonly runs: number };

const NAME = "checks-flake";
const USAGE = `usage: ${NAME} [--runs <count> | --seed <seed>...] [--report <file>]`;
const DEFAULT_RUNS = 10;
const MAX_SEED = 2 ** 32 - 1;
const WORKER_LOG = "CHECKS_FLAKE_WORKER_LOG";
const PRELOAD = "flake-preload.ts";
const SHELL_SAFE = /^[\w./-]+$/;
const SILENT = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;

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

const Manifest = Schema.fromJsonString(Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)) }));
const decodeManifest = Schema.decodeUnknownEffect(Manifest);
const decodeWorkerLine = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ worker: Schema.Int, file: Schema.String })),
);

const workersOf = Effect.fn("workersOf")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  if (!(yield* fs.exists(file))) return undefined;
  const { scripts } = yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeManifest),
    Effect.mapError((cause) => new ManifestError({ message: `cannot read ${file}: ${cause.message}` })),
  );
  const options = scriptOptions(scripts?.["test"]);
  return options === undefined ? undefined : workerCount(options.workers);
});

const assignmentOf = Effect.fn("assignmentOf")(function* (log: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(log))) return [];
  const byWorker = new Map<number, string[]>();
  for (const line of (yield* fs.readFileString(log)).split("\n").filter((entry) => entry !== "")) {
    const { worker, file } = yield* decodeWorkerLine(line).pipe(
      Effect.mapError((cause) => new ReportError({ message: `the worker log is malformed: ${cause.message}` })),
    );
    byWorker.set(worker, [...(byWorker.get(worker) ?? []), path.relative(process.cwd(), file)]);
  }
  return [...byWorker.values()];
});

const seedsOf = (plan: Plan) =>
  "seeds" in plan ? Effect.succeed(plan.seeds) : Effect.replicateEffect(Random.nextIntBetween(0, MAX_SEED), plan.runs);

const spawnSuite = Effect.fn("spawnSuite")(function* (seed: number, outfile: string, workers: number | undefined, log: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", "--randomize", `--seed=${seed}`];
  if (workers === undefined) return yield* spawner.exitCode(ChildProcess.make(process.execPath, [...args, ...reporterArgs(outfile)], SILENT));
  const preload = (yield* Path.Path).join(import.meta.dir, PRELOAD);
  const parallelArgs = [`--parallel=${workers}`, "--preload", preload, ...reporterArgs(outfile)];
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, [...args, ...parallelArgs], { ...SILENT, env: { [WORKER_LOG]: log }, extendEnv: true }),
  );
});

const runOnce = Effect.fn("runOnce")(function* (seed: number, outfile: string, workers: number | undefined) {
  const fs = yield* FileSystem.FileSystem;
  const log = `${outfile}.workers`;
  const passed = (yield* spawnSuite(seed, outfile, workers, log)) === ChildProcessSpawner.ExitCode(0);
  const assignment = yield* assignmentOf(log);
  if (!(yield* fs.exists(outfile))) {
    if (passed) return yield* new ReportError({ message: `bun test passed with seed ${seed} but wrote no report` });
    return { seed, passed, tests: 0, failed: [], crashedFiles: [], assignment } satisfies Run;
  }
  const { results, crashedFiles } = yield* parseReport(yield* fs.readFileString(outfile));
  const failed = results.filter((result) => result.outcome === "failed");
  return { seed, passed, tests: results.length, failed, crashedFiles, assignment } satisfies Run;
});

function outcomeOf(run: Run): string {
  if (run.passed) return "passed";
  return run.failed.length === 0 ? "failed outside any test" : `failed, ${run.failed.length} test(s) failing`;
}

function nameOf(result: TestResult): string {
  return `${result.file}${NAME_SEPARATOR}${result.name}`;
}

export function failingWorkersOf(run: Run): readonly FailingWorker[] {
  if (run.passed) return [];
  const failing = new Set([...run.failed.map((result) => result.file), ...run.crashedFiles]);
  return run.assignment.flatMap((files) => {
    const last = files.findLastIndex((file) => failing.has(file));
    return last === -1 ? [] : [{ seed: run.seed, files: files.slice(0, last + 1) }];
  });
}

export function recordOf(runs: readonly Run[], parallel?: FlakeRecord["parallel"]): FlakeRecord {
  const failures = new Map<string, { file: string; test: string; line: number; seeds: number[] }>();
  for (const run of runs) {
    const failing = new Map(run.failed.map((result) => [nameOf(result), result]));
    for (const [name, result] of failing) {
      const failure = failures.get(name) ?? { file: result.file, test: result.name, line: result.line, seeds: [] };
      failure.seeds.push(run.seed);
      failures.set(name, failure);
    }
  }
  return {
    runs: runs.map(({ seed, passed, tests, failed }) => ({ seed, passed, tests, failed: failed.map(nameOf) })),
    failures: [...failures.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    outsideTests: runs.filter((run) => !run.passed && run.failed.length === 0).map((run) => run.seed),
    ...(parallel === undefined ? {} : { parallel }),
  };
}

function shellWord(file: string): string {
  const word = `./${file}`;
  return SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

function replayFlags(seed: number): readonly string[] {
  return ["--isolate", "--randomize", `--seed=${seed}`];
}

export function replayCommand(seed: number, listed: readonly string[]): string {
  return ["bun test", ...replayFlags(seed), ...listed.map(shellWord)].join(" ");
}

function probeFile(log: string, slot: number): string {
  return `import { test } from "bun:test";\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, "${slot}\\n");\ntest("probe", () => {});\n`;
}

// Bun shuffles the listed files too, by a permutation of their positions that the seed and their count fix.
const replayOf = Effect.fn("replayOf")(function* (worker: FailingWorker, dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const probe = yield* fs.makeTempDirectory({ directory: dir, prefix: "replay-" });
  const log = path.join(probe, "order");
  const slots = worker.files.map((_, slot) => `./${slot}.test.ts`);
  yield* Effect.forEach(slots, (name, slot) => fs.writeFileString(path.join(probe, name), probeFile(log, slot)));
  yield* spawner.exitCode(ChildProcess.make(process.execPath, ["test", ...replayFlags(worker.seed), ...slots], { ...SILENT, cwd: probe }));
  const ran = (yield* fs.readFileString(log)).split("\n").filter((entry) => entry !== "").map(Number);
  const listed = slots.map((_, slot) => worker.files[ran.indexOf(slot)]);
  if (ran.length !== slots.length || !listed.every((file): file is string => file !== undefined)) {
    return yield* new ReportError({ message: `bun ran the replay probe for seed ${worker.seed} in the order ${ran.join(", ")}` });
  }
  return { ...worker, command: replayCommand(worker.seed, listed) } satisfies Replay;
});

function replayLines({ workers, replays }: NonNullable<FlakeRecord["parallel"]>): readonly string[] {
  const lines =
    replays.length === 0
      ? []
      : [
          "",
          "Reproduce a failing run with the files its failing worker ran, listed so the seed runs them in that order:",
          "",
          ...replays.map((replay) => `- seed ${replay.seed}: \`${replay.command}\``),
        ];
  if (workers === 1) return lines;
  return [
    ...lines,
    "",
    `Rerunning a seed with bun test --randomize --seed=<seed> --parallel=${workers} reproduces a failing run only some of the time, because which worker takes each file is a race.`,
  ];
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

export function summary(record: FlakeRecord): string {
  const total = record.runs.length;
  const failedRuns = record.runs.filter((run) => !run.passed).length;
  const on = record.parallel === undefined ? "" : ` on ${record.parallel.workers} worker(s)`;
  if (failedRuns === 0) return `${NAME}: ${total} run(s) passed${on}, with seeds ${record.runs.map((run) => run.seed).join(", ")}`;
  const lines = [`${NAME}: ${failedRuns} of ${total} run(s) failed${on}, ${record.failures.length} test(s) failing in them`];
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
  if (record.parallel === undefined) lines.push("", "Reproduce a failing run with bun test --randomize --seed=<seed>.");
  else lines.push(...replayLines(record.parallel));
  return lines.join("\n");
}

const flake = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { plan, report } = yield* parseArgs(process.argv.slice(2));
  const seeds = yield* seedsOf(plan);
  const workers = yield* workersOf(process.cwd());
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-flake-" });

  const runs = yield* Effect.forEach(seeds, (seed, index) =>
    runOnce(seed, path.join(dir, `${index}.xml`), workers).pipe(
      Effect.tap((run) => Console.log(`${NAME}: run ${index + 1} of ${seeds.length}, seed ${seed}: ${outcomeOf(run)}`)),
    ),
  );
  const parallel =
    workers === undefined
      ? undefined
      : { workers, replays: yield* Effect.forEach(runs.flatMap(failingWorkersOf), (worker) => replayOf(worker, dir)) };
  const record = recordOf(runs, parallel);
  const text = summary(record);
  yield* Console.log(text);

  if (report !== undefined) yield* fs.writeFileString(report, `${JSON.stringify(record, null, 2)}\n`);
  const stepSummary = yield* Config.option(Config.String("GITHUB_STEP_SUMMARY"));
  if (Option.isSome(stepSummary)) yield* fs.writeFileString(stepSummary.value, `${text}\n`, { flag: "a" });
  return runs.every((run) => run.passed);
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, flake);
