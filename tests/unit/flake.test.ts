import { expect, test } from "bun:test";
import { failingWorkersOf, recordOf, replayCommand, summary, type Replay, type Run } from "../../src/testing/flake.ts";
import type { TestResult } from "../../src/testing/test-report.ts";

function failed(file: string, line: number, name: string): TestResult {
  return { file, line, name, outcome: "failed" };
}

function serial(seed: number, tests: number, failing: readonly TestResult[]): Run {
  return { seed, passed: failing.length === 0 && tests > 0, tests, failed: failing, crashedFiles: [], assignment: [] };
}

function files(...names: readonly string[]): readonly string[] {
  return names.map((name) => `tests/${name}.test.ts`);
}

const RUNS: readonly Run[] = [
  serial(7, 3, [failed("tests/b.test.ts", 2, "b | c"), failed("tests/a.test.ts", 5, "a")]),
  serial(9, 3, []),
  serial(4, 3, [failed("tests/a.test.ts", 5, "a"), failed("tests/a.test.ts", 5, "a")]),
  serial(2, 0, []),
];

const SHARED_WORKER = "a and b share one worker";
const PARALLEL_RUNS: readonly Run[] = [
  {
    ...serial(1, 8, [failed("tests/b.test.ts", 5, SHARED_WORKER)]),
    assignment: [files("f2", "f4", "f5", "a", "b"), files("f3", "f6", "f1")],
  },
  { ...serial(1, 8, []), assignment: [files("f2", "f4", "f5", "a"), files("f3", "f6", "f1", "b")] },
  {
    ...serial(4, 8, [failed("tests/a.test.ts", 5, SHARED_WORKER)]),
    assignment: [files("b", "a", "f4", "f6", "f1"), files("f3", "f5", "f2")],
  },
];

test("each failing test carries the seeds of the runs it failed in, once each, in file order", () => {
  const record = recordOf(RUNS);
  expect(record.failures).toEqual([
    { file: "tests/a.test.ts", test: "a", line: 5, seeds: [7, 4] },
    { file: "tests/b.test.ts", test: "b | c", line: 2, seeds: [7] },
  ]);
  expect(record.outsideTests).toEqual([2]);
  expect(record.runs[0]).toEqual({ seed: 7, passed: false, tests: 3, failed: ["tests/b.test.ts > b | c", "tests/a.test.ts > a"] });
});

test("the summary is a markdown table a pipe in a test name cannot break", () => {
  expect(summary(recordOf(RUNS))).toBe(
    [
      "checks-flake: 3 of 4 run(s) failed, 2 test(s) failing in them",
      "",
      "| Test | Failed | Seeds |",
      "| --- | --- | --- |",
      "| tests/a.test.ts:5 a | 2 of 4 runs | 7, 4 |",
      "| tests/b.test.ts:2 b \\| c | 1 of 4 runs | 7 |",
      "",
      "1 run(s) failed outside any test, with seeds 2",
      "",
      "Reproduce a failing run with bun test --randomize --seed=<seed>.",
    ].join("\n"),
  );
  expect(summary(recordOf(RUNS.slice(1, 2)))).toBe("checks-flake: 1 run(s) passed, with seeds 9");
});

test("a serial hunt records no workers and no replays", () => {
  expect(Object.keys(recordOf(RUNS))).toEqual(["runs", "failures", "outsideTests"]);
});

const REPLAYS: readonly Replay[] = [
  {
    seed: 1,
    files: files("f2", "f4", "f5", "a", "b"),
    command: "bun test --isolate --randomize --seed=1 ./tests/a.test.ts ./tests/f2.test.ts ./tests/b.test.ts ./tests/f5.test.ts ./tests/f4.test.ts",
  },
  { seed: 4, files: files("b", "a"), command: "bun test --isolate --randomize --seed=4 ./tests/a.test.ts ./tests/b.test.ts" },
];

test("a failing parallel run replays the files its failing worker ran, in order, up to the failing one", () => {
  expect(PARALLEL_RUNS.flatMap(failingWorkersOf)).toEqual([
    { seed: 1, files: files("f2", "f4", "f5", "a", "b") },
    { seed: 4, files: files("b", "a") },
  ]);
});

test("a run whose worker crashed replays that worker's files up to the crashed file", () => {
  const crashed: Run = {
    ...serial(3, 2, []),
    passed: false,
    crashedFiles: files("exits"),
    assignment: [files("f1"), files("f2", "exits")],
  };
  expect(failingWorkersOf(crashed)).toEqual([{ seed: 3, files: files("f2", "exits") }]);
});

test("a replay keeps the seed and quotes a path the shell would split", () => {
  expect(replayCommand(1, ["tests/it's here.test.ts", "tests/a.test.ts"])).toBe(
    "bun test --isolate --randomize --seed=1 './tests/it'\\''s here.test.ts' ./tests/a.test.ts",
  );
});

test("the parallel summary names the worker count and says a rerun seed reproduces only sometimes", () => {
  const rerun = "Rerunning a seed with bun test --randomize --seed=<seed> --parallel=2 reproduces a failing run only some of the time, because which worker takes each file is a race.";
  expect(summary(recordOf(PARALLEL_RUNS, { workers: 2, replays: REPLAYS }))).toBe(
    [
      "checks-flake: 2 of 3 run(s) failed on 2 worker(s), 2 test(s) failing in them",
      "",
      "| Test | Failed | Seeds |",
      "| --- | --- | --- |",
      `| tests/a.test.ts:5 ${SHARED_WORKER} | 1 of 3 runs | 4 |`,
      `| tests/b.test.ts:5 ${SHARED_WORKER} | 1 of 3 runs | 1 |`,
      "",
      "Reproduce a failing run with the files its failing worker ran, listed so the seed runs them in that order:",
      "",
      "- seed 1: `bun test --isolate --randomize --seed=1 ./tests/a.test.ts ./tests/f2.test.ts ./tests/b.test.ts ./tests/f5.test.ts ./tests/f4.test.ts`",
      "- seed 4: `bun test --isolate --randomize --seed=4 ./tests/a.test.ts ./tests/b.test.ts`",
      "",
      rerun,
    ].join("\n"),
  );
  expect(summary(recordOf(PARALLEL_RUNS.slice(1, 2), { workers: 2, replays: [] }))).toBe("checks-flake: 1 run(s) passed on 2 worker(s), with seeds 1");
});

test("on one worker no file can go to another worker, so the summary does not call a rerun seed a race", () => {
  expect(summary(recordOf(PARALLEL_RUNS, { workers: 1, replays: REPLAYS }))).not.toContain("race");
});

test("a seed replayed twice counts each run it failed in", () => {
  const replayed: readonly Run[] = [serial(7, 1, [failed("tests/a.test.ts", 5, "a")]), serial(7, 1, [failed("tests/a.test.ts", 5, "a")])];
  expect(recordOf(replayed).failures).toEqual([{ file: "tests/a.test.ts", test: "a", line: 5, seeds: [7, 7] }]);
  expect(summary(recordOf(replayed))).toContain("| tests/a.test.ts:5 a | 2 of 2 runs | 7, 7 |");
});
