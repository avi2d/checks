import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { fileSeconds, parseReport } from "../../src/testing/test-report.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "test-report");
const REPORT = join(FIXTURES, "bun.xml");
const CRASH_REPORT = join(FIXTURES, "bun-parallel-crash.xml");
const TIMED_REPORT = join(FIXTURES, "bun-timed.xml");

function failureOf(xml: string): string {
  const exit = Effect.runSyncExit(parseReport(xml));
  if (Exit.isSuccess(exit)) throw new Error(`parsed ${JSON.stringify(exit.value)}`);
  return String(exit.cause);
}

test("a report bun wrote reads as one result per test, named as bun's console names it", async () => {
  const { results, crashedFiles } = Effect.runSync(parseReport(await readFile(REPORT, "utf8")));
  expect(crashedFiles).toEqual([]);
  expect(results).toEqual([
    { file: "tests/b.test.ts", name: "throws", line: 2, outcome: "failed" },
    { file: "tests/b.test.ts", name: "plain skip", line: 3, outcome: "skipped" },
    { file: "tests/a.test.ts", name: "passes", line: 2, outcome: "passed" },
    { file: "tests/a.test.ts", name: "plain skip", line: 3, outcome: "skipped" },
    { file: "tests/a.test.ts", name: "skip if", line: 4, outcome: "skipped" },
    { file: "tests/a.test.ts", name: "if false", line: 5, outcome: "skipped" },
    { file: "tests/a.test.ts", name: "a todo", line: 6, outcome: "todo" },
    { file: "tests/a.test.ts", name: "outer > inner > in skipped describe", line: 9, outcome: "skipped" },
    { file: "tests/a.test.ts", name: 'outer > fails & <weird> "name"', line: 11, outcome: "failed" },
    { file: "tests/a.test.ts", name: "outer > times out", line: 12, outcome: "failed" },
    { file: "tests/a.test.ts", name: "a > b > c", line: 14, outcome: "passed" },
  ]);
});

test("a file whose parallel worker crashed reads as crashed, and the other files' results stay", async () => {
  const { results, crashedFiles } = Effect.runSync(parseReport(await readFile(CRASH_REPORT, "utf8")));
  expect(crashedFiles).toEqual(["tests/d.test.ts"]);
  expect(results).toEqual([
    { file: "tests/c.test.ts", name: "c fails", line: 2, outcome: "failed" },
    { file: "tests/b.test.ts", name: "b pass", line: 2, outcome: "passed" },
    { file: "tests/b.test.ts", name: "b skipped", line: 3, outcome: "skipped" },
  ]);
});

test("a lineless testcase that did not fail is refused", () => {
  expect(failureOf('<testsuites><testsuite name="f"><testcase name="t" file="f"/></testsuite></testsuites>')).toContain(
    "holds a <testcase> bun never writes",
  );
});

test("a report bun did not write whole is refused rather than read as fewer tests", () => {
  expect(failureOf("")).toContain("the root is not one <testsuites>");
  expect(failureOf("<testsuites><testsuite name=\"f\">")).toContain("<testsuite> never closes");
  expect(failureOf("<testsuites></testsuite>")).toContain("</testsuite> closes <testsuites>");
  expect(failureOf("<testsuites>< testsuite/></testsuites>")).toContain("stray <");
  expect(failureOf("<testsuites/><testsuites/>")).toContain("the root is not one <testsuites>");
  expect(failureOf('<testsuites><testsuite name="f"><testcase name="t" file="f" line="x"/></testsuite></testsuites>')).toContain(
    "holds a <testcase> bun never writes",
  );
});

test("each file's seconds come from the top-level testsuite bun wrote for it, under the path it names with no leading ./", async () => {
  const seconds = Effect.runSync(fileSeconds(await readFile(TIMED_REPORT, "utf8")));
  expect([...seconds]).toEqual([
    ["tests/unit/g/a.test.ts", 0.302154459],
    ["tests/unit/b.test.ts", 0.000615409],
  ]);
});

test("a file testsuite with no time is refused rather than read as instant", () => {
  const exit = Effect.runSyncExit(fileSeconds('<testsuites><testsuite name="f" file="f"></testsuite></testsuites>'));
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("a <testsuite> with no file or time");
});

test("character references decode in names", () => {
  const xml = '<testsuites><testsuite name="f"><testcase name="a&#10;b&#x41;&apos;" file="f" line="1"/></testsuite></testsuites>';
  expect(Effect.runSync(parseReport(xml)).results).toEqual([{ file: "f", name: "a\nbA'", line: 1, outcome: "passed" }]);
});
