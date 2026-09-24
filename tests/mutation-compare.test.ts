import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { Usage } from "../scripts/main.ts";
import {
  compareReports,
  formatComparison,
  parseArgs,
  parseReport,
  passes,
  ReportError,
} from "../scripts/mutation-compare.ts";

const FIXTURES = new URL("./fixtures/mutation-compare/", import.meta.url);

async function fixture(name: string): Promise<ReadonlyMap<string, readonly string[]>> {
  return Effect.runSync(parseReport(name, await readFile(new URL(name, FIXTURES), "utf8")));
}

function statuses(killed: number, survived: number): string[] {
  return [...Array<string>(killed).fill("Killed"), ...Array<string>(survived).fill("Survived")];
}

test("a planted regression goes red", async () => {
  const comparison = compareReports(await fixture("base.json"), await fixture("head-regressed.json"));
  expect(comparison.base).toEqual({ killed: 7, total: 10 });
  expect(comparison.head).toEqual({ killed: 6, total: 12 });
  expect(comparison.regression).toBe(true);
  expect(passes(comparison, false)).toBe(false);
  const report = formatComparison(comparison, false);
  expect(report).toContain("base 70.00% (7/10) head 50.00% (6/12) delta -20.00pp");
  expect(report).toContain("src/changed.ts: 75.00% (3/4) -> 50.00% (2/4)");
  expect(report).toContain("src/added.ts: n/a (0/0) -> 0.00% (0/2)");
  expect(report).toContain("1 unchanged file(s)");
  expect(report).toContain("REGRESSION");
});

test("the same report without the regression goes green", async () => {
  const comparison = compareReports(await fixture("base.json"), await fixture("head-fixed.json"));
  expect(comparison.head).toEqual({ killed: 8, total: 10 });
  expect(comparison.regression).toBe(false);
  expect(passes(comparison, false)).toBe(true);
  expect(formatComparison(comparison, false)).toContain("no regression");
});

test("an equal score passes", async () => {
  const base = await fixture("base.json");
  const comparison = compareReports(base, await fixture("base.json"));
  expect(comparison.regression).toBe(false);
  expect(passes(comparison, false)).toBe(true);
});

test("the verdict compares whole-report scores, not only the changed files", () => {
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
  expect(comparison.base).toEqual({ killed: 1001, total: 1502 });
  expect(comparison.head).toEqual({ killed: 1051, total: 1600 });
  expect(comparison.regression).toBe(true);
  expect(passes(comparison, false)).toBe(false);
});

test("a file present in only one report counts toward that report's score", async () => {
  const addedOnly = compareReports(
    await fixture("base.json"),
    new Map([...await fixture("base.json"), ["src/added.ts", ["Survived", "Survived"]]]),
  );
  expect(addedOnly.head).toEqual({ killed: 7, total: 12 });
  expect(addedOnly.regression).toBe(true);
  const removedOnly = compareReports(
    new Map([...await fixture("base.json"), ["src/gone.ts", ["Survived"]]]),
    await fixture("base.json"),
  );
  expect(removedOnly.base).toEqual({ killed: 7, total: 11 });
  expect(removedOnly.regression).toBe(false);
});

test("invalid, ignored and pending mutants leave the score as Stryker scores it", () => {
  const base = new Map([["src/a.ts", ["Killed", "Killed", "Killed", "Survived"]]]);
  const head = new Map([
    [
      "src/a.ts",
      ["Killed", "Timeout", "Killed", "NoCoverage", "CompileError", "CompileError", "RuntimeError", "Ignored", "Pending"],
    ],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.head).toEqual({ killed: 3, total: 4 });
  expect(comparison.regression).toBe(false);
});

test("advisory mode prints the same verdict and always exits 0", async () => {
  const comparison = compareReports(await fixture("base.json"), await fixture("head-regressed.json"));
  expect(passes(comparison, true)).toBe(true);
  expect(formatComparison(comparison, true)).toContain("REGRESSION");
  expect(formatComparison(comparison, true)).toContain("advisory");
});

test("only the --advisory flag turns on advisory mode", () => {
  expect(Effect.runSync(parseArgs(["base.json", "head.json", "--advisory"])).advisory).toBe(true);
  expect(Effect.runSync(parseArgs(["base.json", "head.json"])).advisory).toBe(false);
  expect(() => Effect.runSync(parseArgs(["only-one.json"]))).toThrow(Usage);
});

test("a report without a files table is refused", () => {
  expect(() => Effect.runSync(parseReport("report", "{}"))).toThrow(ReportError);
  expect(() => Effect.runSync(parseReport("report", "not json"))).toThrow(ReportError);
});
