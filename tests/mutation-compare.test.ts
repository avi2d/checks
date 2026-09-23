import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  compareReports,
  exitFor,
  formatComparison,
  parseArgs,
  parseReport,
  ReportError,
} from "../scripts/mutation-compare.ts";

const FIXTURES = new URL("./fixtures/mutation-compare/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, FIXTURES), "utf8");
}

function statuses(killed: number, survived: number): string[] {
  return [...Array<string>(killed).fill("Killed"), ...Array<string>(survived).fill("Survived")];
}

test("a planted regression goes red", async () => {
  const comparison = compareReports(parseReport(await fixture("base.json")), parseReport(await fixture("head-regressed.json")));
  expect(comparison.base).toEqual({ killed: 3, total: 4 });
  expect(comparison.head).toEqual({ killed: 2, total: 4 });
  expect(comparison.regression).toBe(true);
  expect(exitFor(comparison, false)).toBe(1);
  const report = formatComparison(comparison, false);
  expect(report).toContain("base 75.00% (3/4) head 50.00% (2/4) delta -25.00pp");
  expect(report).toContain("src/changed.ts: 75.00% -> 50.00% (-25.00pp)");
  expect(report).toContain("REGRESSION");
});

test("the same report without the regression goes green", async () => {
  const comparison = compareReports(parseReport(await fixture("base.json")), parseReport(await fixture("head-fixed.json")));
  expect(comparison.head).toEqual({ killed: 4, total: 4 });
  expect(comparison.regression).toBe(false);
  expect(exitFor(comparison, false)).toBe(0);
  expect(formatComparison(comparison, false)).toContain("no regression");
});

test("an equal score passes", async () => {
  const base = parseReport(await fixture("base.json"));
  const comparison = compareReports(base, parseReport(await fixture("base.json")));
  expect(comparison.regression).toBe(false);
  expect(exitFor(comparison, false)).toBe(0);
});

test("survivors in unchanged files do not change the verdict", () => {
  const stable = statuses(1000, 500);
  const base = new Map([
    ["src/changed.ts", ["Killed", "Survived"]],
    ["src/stable.ts", stable],
  ]);
  const head = new Map([
    ["src/changed.ts", ["Killed", "Killed", ...statuses(49, 49)]],
    ["src/stable.ts", stable],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.base).toEqual({ killed: 1, total: 2 });
  expect(comparison.head).toEqual({ killed: 50, total: 100 });
  expect(comparison.regression).toBe(false);
  expect(exitFor(comparison, false)).toBe(0);
});

test("a file present in only one report is listed and excluded from the verdict", async () => {
  const comparison = compareReports(parseReport(await fixture("base.json")), parseReport(await fixture("head-regressed.json")));
  expect(comparison.onlyInHead).toEqual(["src/added.ts"]);
  expect(comparison.onlyInBase).toEqual([]);
  expect(formatComparison(comparison, false)).toContain("src/added.ts: only in head");
  const addedOnly = compareReports(
    parseReport(await fixture("base.json")),
    new Map([...parseReport(await fixture("base.json")), ["src/added.ts", ["Survived", "Survived"]]]),
  );
  expect(addedOnly.regression).toBe(false);
  expect(exitFor(addedOnly, false)).toBe(0);
  const removedOnly = compareReports(
    new Map([...parseReport(await fixture("base.json")), ["src/gone.ts", ["Survived"]]]),
    parseReport(await fixture("base.json")),
  );
  expect(removedOnly.onlyInBase).toEqual(["src/gone.ts"]);
  expect(removedOnly.regression).toBe(false);
});

test("advisory mode prints the same verdict and always exits 0", async () => {
  const comparison = compareReports(parseReport(await fixture("base.json")), parseReport(await fixture("head-regressed.json")));
  expect(exitFor(comparison, true)).toBe(0);
  expect(formatComparison(comparison, true)).toContain("REGRESSION");
  expect(formatComparison(comparison, true)).toContain("advisory");
});

test("the advisory flag and environment variable agree", () => {
  expect(parseArgs(["base.json", "head.json", "--advisory"], {}).advisory).toBe(true);
  expect(parseArgs(["base.json", "head.json"], { CHECKS_MUTATION_ADVISORY: "1" }).advisory).toBe(true);
  expect(parseArgs(["base.json", "head.json"], {}).advisory).toBe(false);
  expect(() => parseArgs(["only-one.json"], {})).toThrow(ReportError);
});

test("a report without a files table is refused", () => {
  expect(() => parseReport("{}")).toThrow(ReportError);
  expect(() => parseReport("not json")).toThrow(ReportError);
});
