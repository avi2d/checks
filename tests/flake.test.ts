import { expect, test } from "bun:test";
import { recordOf, summary, type Run } from "../scripts/flake.ts";
import type { TestResult } from "../scripts/test-report.ts";

function failed(file: string, line: number, name: string): TestResult {
  return { file, line, name, outcome: "failed" };
}

const RUNS: readonly Run[] = [
  { seed: 7, passed: false, tests: 3, failed: [failed("tests/b.test.ts", 2, "b | c"), failed("tests/a.test.ts", 5, "a")] },
  { seed: 9, passed: true, tests: 3, failed: [] },
  { seed: 4, passed: false, tests: 3, failed: [failed("tests/a.test.ts", 5, "a"), failed("tests/a.test.ts", 5, "a")] },
  { seed: 2, passed: false, tests: 0, failed: [] },
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
