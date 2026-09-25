import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { Usage } from "../scripts/main.ts";
import {
  compareReports,
  formatComparison,
  type Mutant,
  parseArgs,
  parseReport,
  passes,
  ReportError,
} from "../scripts/mutation-compare.ts";

const FIXTURES = new URL("./fixtures/mutation-compare/", import.meta.url);

async function fixture(name: string): Promise<ReadonlyMap<string, readonly Mutant[]>> {
  return Effect.runSync(parseReport(name, await readFile(new URL(name, FIXTURES), "utf8")));
}

function mutant(overrides: Partial<Mutant> & { readonly status: string }): Mutant {
  return {
    mutatorName: "ArithmeticOperator",
    replacement: "a - b",
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    ...overrides,
  };
}

test("a planted regression goes red", async () => {
  const comparison = compareReports(await fixture("base.json"), await fixture("head-regressed.json"));
  expect(comparison.regression).toBe(true);
  expect(passes(comparison, false)).toBe(false);
  expect(comparison.regressions).toHaveLength(1);
  const [change] = comparison.regressions;
  expect(change).toMatchObject({ path: "src/changed.ts", from: "Killed", to: "Survived" });
  const report = formatComparison(comparison, false);
  expect(report).toContain("REGRESSION (1 mutant(s))");
  expect(report).toContain("regression src/changed.ts:2:9 BlockStatement");
});

test("the same report without the regression goes green", async () => {
  const comparison = compareReports(await fixture("base.json"), await fixture("head-fixed.json"));
  expect(comparison.regression).toBe(false);
  expect(passes(comparison, false)).toBe(true);
  expect(formatComparison(comparison, false)).toContain("no regression");
});

test("an equal report passes", async () => {
  const base = await fixture("base.json");
  const comparison = compareReports(base, base);
  expect(comparison.regression).toBe(false);
  expect(passes(comparison, false)).toBe(true);
});

test("a lost kill hiding behind a score gain still fails", () => {
  const base = new Map([
    ["src/a.ts", [mutant({ status: "Killed", location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } })]],
  ]);
  const head = new Map([
    [
      "src/a.ts",
      [
        mutant({ status: "Survived", location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } }),
        mutant({ status: "Killed", mutatorName: "EqualityOperator", replacement: "a === b", location: { start: { line: 2, column: 1 }, end: { line: 2, column: 2 } } }),
        mutant({ status: "Killed", mutatorName: "EqualityOperator", replacement: "a !== b", location: { start: { line: 3, column: 1 }, end: { line: 3, column: 2 } } }),
      ],
    ],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(true);
  expect(comparison.regressions).toHaveLength(1);
  expect(comparison.regressions[0]).toMatchObject({ path: "src/a.ts", from: "Killed", to: "Survived" });
});

test("run B's shape, kills moving to RuntimeError under bail, holds no regression", () => {
  const base = new Map([["src/loader.ts", Array.from({ length: 78 }, (_, i) => mutant({ status: "Killed", location: { start: { line: i + 1, column: 1 }, end: { line: i + 1, column: 2 } } }))]]);
  const head = new Map([["src/loader.ts", Array.from({ length: 78 }, (_, i) => mutant({ status: "RuntimeError", location: { start: { line: i + 1, column: 1 }, end: { line: i + 1, column: 2 } } }))]]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(false);
  expect(comparison.regressions).toHaveLength(0);
  expect(comparison.runtimeMoves).toHaveLength(78);
  expect(passes(comparison, false)).toBe(true);
  expect(formatComparison(comparison, false)).toContain("no regression");
});

test("duplicate location, mutator and replacement within a file match by occurrence order", () => {
  const location = { start: { line: 5, column: 3 }, end: { line: 5, column: 10 } };
  const base = new Map([
    ["src/dup.ts", [mutant({ status: "Killed", location }), mutant({ status: "Killed", location })]],
  ]);
  const head = new Map([
    ["src/dup.ts", [mutant({ status: "Killed", location }), mutant({ status: "Survived", location })]],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.regressions).toHaveLength(1);
});

test("mutants with no counterpart are listed and never fail the comparison", () => {
  const base = new Map([["src/a.ts", [mutant({ status: "Survived", location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } })]]]);
  const head = new Map([["src/a.ts", [mutant({ status: "Survived", location: { start: { line: 2, column: 1 }, end: { line: 2, column: 2 } } })]]]);
  const comparison = compareReports(base, head);
  expect(comparison.baseOnly).toHaveLength(1);
  expect(comparison.headOnly).toHaveLength(1);
  expect(comparison.regression).toBe(false);
});

test("a CompileError move is reported apart from regressions", () => {
  const location = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } };
  const base = new Map([["src/a.ts", [mutant({ status: "Killed", location })]]]);
  const head = new Map([["src/a.ts", [mutant({ status: "CompileError", location })]]]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(false);
  expect(comparison.runtimeMoves).toHaveLength(1);
  expect(formatComparison(comparison, false)).toContain("moved src/a.ts:1:1");
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
