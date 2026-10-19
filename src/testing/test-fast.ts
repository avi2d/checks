#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { changedPaths, defaultBranch, git, rangeEnds, type Change } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { parseReport, reporterArgs, ReportError } from "./test-report.ts";
import { judgeSkips, passes, report, SkipGateError } from "./test.ts";
import { readSkipDeclarations, type Environment } from "./test-skips.ts";

const NAME = "test-fast";
const USAGE = "usage: test-fast, which runs the unit tier and the e2e test files the change touches, and it takes no arguments";

const E2E_PREFIX = "tests/e2e/";
const TEST_SUFFIXES = [".test.ts", ".test.tsx"] as const;

export function keptPaths(changes: readonly Change[]): readonly string[] {
  return changes.filter((change) => change.kind !== "deleted").map((change) => change.path);
}

export function touchedE2eFiles(paths: readonly string[]): readonly string[] {
  const picked = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(E2E_PREFIX)) continue;
    if (!TEST_SUFFIXES.some((suffix) => path.endsWith(suffix))) continue;
    picked.add(path);
  }
  return [...picked].sort();
}

const splitZero = (output: string): readonly string[] => output.split("\0").filter((line) => line !== "");

const touchedFiles = Effect.fn("touchedFiles")(function* (root: string) {
  const target = yield* defaultBranch(root);
  const range = yield* rangeEnds(target, "HEAD", root);
  const committed = keptPaths(yield* changedPaths(range.base, range.head, [], root));
  const working = splitZero(yield* git(["diff", "--name-only", "-z", "HEAD", "--"], root));
  const untracked = splitZero(yield* git(["ls-files", "--others", "--exclude-standard", "-z"], root));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.filter(touchedE2eFiles([...committed, ...working, ...untracked]), (file) =>
    fs.exists(path.join(root, file)), { concurrency: "unbounded" });
});

const environmentOf = Config.Boolean("CI").pipe(
  Config.withDefault(false),
  Config.map((ci): Environment => (ci ? "ci" : "local")),
  Effect.mapError((cause) => new SkipGateError({ message: "cannot tell a ci run from a local one: " + cause.message })),
);

const runUnitTier = Effect.fn("runUnitTier")(function* (root: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  return yield* spawner.exitCode(
    ChildProcess.make(process.execPath, [path.join(import.meta.dir, "test.ts"), "--tier=unit"], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      cwd: root,
    }),
  );
});

const runE2eFiles = Effect.fn("runE2eFiles")(function* (root: string, files: readonly string[], environment: Environment) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outfile = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-fast-" }), "junit.xml");
  const suitePassed = (yield* spawner.exitCode(
    ChildProcess.make(process.execPath, ["test", "--randomize", ...reporterArgs(outfile), ...files], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      cwd: root,
      env: { CI: "true" },
      extendEnv: true,
    }),
  )) === ChildProcessSpawner.ExitCode(0);
  const written = yield* fs.exists(outfile);
  if (!written) {
    if (!suitePassed) {
      yield* Console.error(NAME + ": bun test failed before it wrote a report, so no skip was judged");
      return false;
    }
    return yield* new ReportError({ message: "bun test passed but wrote no report to " + outfile });
  }
  const { results, crashedFiles } = yield* parseReport(yield* fs.readFileString(outfile));
  for (const file of crashedFiles) yield* Console.error(NAME + ": the worker running " + file + " crashed, so its skips were not judged");
  const judged = (yield* readSkipDeclarations(root, "e2e")).filter((declaration) => files.includes(declaration.file));
  const verdict = judgeSkips(results, judged, environment);
  yield* passes(verdict) ? Console.log(report(verdict)) : Console.error(report(verdict));
  return suitePassed && crashedFiles.length === 0 && passes(verdict);
});

const fastEntry = Effect.gen(function* () {
  if (process.argv.slice(2).length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if ((yield* runUnitTier(root)) !== ChildProcessSpawner.ExitCode(0)) return false;
  const files = yield* touchedFiles(root);
  if (files.length === 0) {
    yield* Console.log(NAME + ": the change touches no e2e test files, so only the unit tier ran");
    return true;
  }
  yield* Console.log(NAME + ": the change touches " + files.length + " e2e test file(s): " + files.join(" "));
  return yield* runE2eFiles(root, files, yield* environmentOf);
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, fastEntry);
