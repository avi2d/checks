import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { Usage } from "../scripts/main.ts";
import { parseReport, ReportError } from "../scripts/mutation-compare.ts";
import { analyze, formatReport, parseArgs, type Report } from "../scripts/subsumed-tests.ts";

const FIXTURES = new URL("./fixtures/subsumed-tests/", import.meta.url);

async function fixture(name: string): Promise<Report> {
  const text = await readFile(new URL(name, FIXTURES), "utf8");
  return analyze(Effect.runSync(parseReport(name, text)));
}

test("a subsumed pair names the test and its subsumer with both kill counts", async () => {
  const report = await fixture("report.json");
  expect(report.subsumed).toEqual([{ test: "narrow", kills: 1, subsumedBy: "wide", subsumerKills: 3 }]);
  const text = formatReport(report);
  expect(text).toContain('"narrow" (1 kill) subsumed by "wide" (3 kills)');
});

test("an identical pair is grouped apart from subsumption", async () => {
  const report = await fixture("report.json");
  expect(report.identical).toEqual([{ tests: ["twin-a", "twin-b"], kills: 2 }]);
  expect(report.subsumed.map((one) => one.test)).not.toContain("twin-a");
  expect(report.subsumed.map((one) => one.test)).not.toContain("twin-b");
  expect(formatReport(report)).toContain('"twin-a" (2 kills) = "twin-b" (2 kills)');
});

test("a test with a unique kill is listed nowhere", async () => {
  const report = await fixture("report.json");
  expect(report.subsumed.map((one) => one.test)).not.toContain("loner");
  expect(report.identical.flatMap((group) => group.tests)).not.toContain("loner");
});

test("the greedy cover keeps every kill", async () => {
  const report = await fixture("report.json");
  expect(report.cover.kills).toBe(6);
  expect(report.cover.tests).toBe(5);
  expect(report.cover.members).toEqual(["wide", "twin-a", "loner"]);
  expect(formatReport(report)).toContain("greedy cover: 3 of 5 test(s) keep all 6 kill(s)");
});

test("the report opens with the files the run mutated", async () => {
  const report = await fixture("report.json");
  expect(report.files).toEqual(["src/a.ts", "src/b.ts"]);
  const text = formatReport(report);
  expect(text.indexOf("mutated src/a.ts")).toBeLessThan(text.indexOf("subsumed tests"));
});

test("only the report path parses", () => {
  expect(Effect.runSync(parseArgs(["report.json"])).reportPath).toBe("report.json");
  expect(() => Effect.runSync(parseArgs([]))).toThrow(Usage);
  expect(() => Effect.runSync(parseArgs(["a.json", "b.json"]))).toThrow(Usage);
});

test("a report without a files table is refused", () => {
  expect(() => Effect.runSync(parseReport("report", "{}"))).toThrow(ReportError);
});
