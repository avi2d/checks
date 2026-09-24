import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { parseReport } from "../scripts/test-report.ts";

const REPORT = join(import.meta.dir, "fixtures", "test-report", "bun.xml");

function failureOf(xml: string): string {
  const exit = Effect.runSyncExit(parseReport(xml));
  if (Exit.isSuccess(exit)) throw new Error(`parsed ${JSON.stringify(exit.value)}`);
  return String(exit.cause);
}

test("a report bun wrote reads as one result per test, named as bun's console names it", async () => {
  const results = Effect.runSync(parseReport(await readFile(REPORT, "utf8")));
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

test("character references decode in names", () => {
  const xml = '<testsuites><testsuite name="f"><testcase name="a&#10;b&#x41;&apos;" file="f" line="1"/></testsuite></testsuites>';
  expect(Effect.runSync(parseReport(xml))).toEqual([{ file: "f", name: "a\nbA'", line: 1, outcome: "passed" }]);
});
