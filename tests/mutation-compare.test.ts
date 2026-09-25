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
  type ReportFile,
  ReportError,
} from "../scripts/mutation-compare.ts";

const FIXTURES = new URL("./fixtures/mutation-compare/", import.meta.url);

async function fixture(name: string): Promise<ReadonlyMap<string, ReportFile>> {
  return Effect.runSync(parseReport(name, await readFile(new URL(name, FIXTURES), "utf8")));
}

function at(line: number, start: number, end: number): Mutant["location"] {
  return { start: { line, column: start }, end: { line, column: end } };
}

function mutant(overrides: Partial<Mutant> & { readonly status: string }): Mutant {
  return {
    mutatorName: "ArithmeticOperator",
    replacement: "a - b",
    killedBy: [],
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
  const source = "x\ny\nz\n";
  const base = new Map([["src/a.ts", { source, mutants: [mutant({ status: "Killed", location: at(1, 1, 2) })] }]]);
  const head = new Map([
    [
      "src/a.ts",
      {
        source,
        mutants: [
          mutant({ status: "Survived", location: at(1, 1, 2) }),
          mutant({ status: "Killed", mutatorName: "EqualityOperator", replacement: "a === b", location: at(2, 1, 2) }),
          mutant({ status: "Killed", mutatorName: "EqualityOperator", replacement: "a !== b", location: at(3, 1, 2) }),
        ],
      },
    ],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(true);
  expect(comparison.regressions).toHaveLength(1);
  expect(comparison.regressions[0]).toMatchObject({ path: "src/a.ts", from: "Killed", to: "Survived" });
});

test("a lost kill below an inserted line still fails", () => {
  const body = ["export function charge(total: number, limit: number): number {", "  const fee = total * 0.1;", ...Array.from({ length: 9 }, () => ""), "    total > limit;", "  return total + fee;", "}", ""];
  const billing = (lines: readonly string[]) => ({ source: lines.join("\n") });
  const base = new Map([
    [
      "src/billing.ts",
      {
        ...billing(body),
        mutants: [
          mutant({ status: "Killed", replacement: "total / 0.1", location: at(2, 15, 26) }),
          mutant({ status: "Killed", mutatorName: "ConditionalExpression", replacement: "true", location: at(12, 5, 18) }),
        ],
      },
    ],
  ]);
  const head = new Map([
    [
      "src/billing.ts",
      {
        ...billing(["// Billing.", ...body]),
        mutants: [
          mutant({ status: "Killed", replacement: "total / 0.1", location: at(3, 15, 26) }),
          mutant({ status: "Survived", mutatorName: "ConditionalExpression", replacement: "true", location: at(13, 5, 18) }),
        ],
      },
    ],
  ]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(true);
  expect(comparison.regressions).toHaveLength(1);
  expect(comparison.baseOnly).toHaveLength(0);
  expect(comparison.headOnly).toHaveLength(0);
  expect(formatComparison(comparison, false)).toContain('regression src/billing.ts:13:5 ConditionalExpression "true": Killed -> Survived');
});

test("run B's shape, kills moving to RuntimeError under bail, holds no regression", () => {
  const source = Array.from({ length: 78 }, (_, i) => `load(${i});`).join("\n");
  const loader = (status: string) => new Map([["src/loader.ts", { source, mutants: Array.from({ length: 78 }, (_, i) => mutant({ status, location: at(i + 1, 1, 5) })) }]]);
  const comparison = compareReports(loader("Killed"), loader("RuntimeError"));
  expect(comparison.regression).toBe(false);
  expect(comparison.regressions).toHaveLength(0);
  expect(comparison.moves).toHaveLength(78);
  expect(passes(comparison, false)).toBe(true);
  expect(formatComparison(comparison, false)).toContain("no regression");
});

test("mutants sharing a location, mutator and replacement match by occurrence order", () => {
  const source = "a + b;\n";
  const base = new Map([["src/dup.ts", { source, mutants: [mutant({ status: "Killed", location: at(1, 1, 6) }), mutant({ status: "Killed", location: at(1, 1, 6) })] }]]);
  const head = new Map([["src/dup.ts", { source, mutants: [mutant({ status: "Killed", location: at(1, 1, 6) }), mutant({ status: "Survived", location: at(1, 1, 6) })] }]]);
  const comparison = compareReports(base, head);
  expect(comparison.regressions).toHaveLength(1);
});

test("an untested duplicate added above a killed mutant is listed, not a regression", () => {
  const flip = (status: string, line: number) => mutant({ status, mutatorName: "BooleanLiteral", replacement: "false", location: at(line, 3, 7) });
  const base = new Map([["src/a.ts", { source: "f(true);\n", mutants: [flip("Killed", 1)] }]]);
  const head = new Map([["src/a.ts", { source: "g(true);\nf(true);\n", mutants: [flip("NoCoverage", 1), flip("Killed", 2)] }]]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(false);
  expect(comparison.baseOnly).toHaveLength(0);
  expect(comparison.headOnly).toMatchObject([{ path: "src/a.ts", status: "NoCoverage", location: at(1, 3, 7) }]);
});

test("a lost kill below a removed duplicate still fails", () => {
  const flip = (status: string, line: number) => mutant({ status, mutatorName: "BooleanLiteral", replacement: "false", location: at(line, 3, 7) });
  const base = new Map([["src/a.ts", { source: "g(true);\nf(true);\n", mutants: [flip("NoCoverage", 1), flip("Killed", 2)] }]]);
  const head = new Map([["src/a.ts", { source: "f(true);\n", mutants: [flip("Survived", 1)] }]]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(true);
  expect(comparison.regressions).toMatchObject([{ path: "src/a.ts", from: "Killed", to: "Survived", location: at(1, 3, 7) }]);
  expect(comparison.baseOnly).toMatchObject([{ path: "src/a.ts", status: "NoCoverage", location: at(1, 3, 7) }]);
  expect(comparison.headOnly).toHaveLength(0);
});

test("mutants on a changed line have no counterpart, are listed and never fail the comparison", () => {
  const base = new Map([["src/a.ts", { source: "a + b;\n", mutants: [mutant({ status: "Killed", location: at(1, 1, 6) })] }]]);
  const head = new Map([["src/a.ts", { source: "a + c;\n", mutants: [mutant({ status: "Survived", location: at(1, 1, 6) })] }]]);
  const comparison = compareReports(base, head);
  expect(comparison.baseOnly).toHaveLength(1);
  expect(comparison.headOnly).toHaveLength(1);
  expect(comparison.regression).toBe(false);
});

test("moves into or out of the statuses that leave the score are reported apart from regressions, in line order", () => {
  const source = Array.from({ length: 10 }, (_, i) => `v${i};`).join("\n");
  const report = (statuses: readonly [string, number][]) => new Map([["src/a.ts", { source, mutants: statuses.map(([status, line]) => mutant({ status, location: at(line, 1, 3) })) }]]);
  const base = report([["Killed", 10], ["Killed", 2], ["Pending", 3], ["Killed", 1]]);
  const head = report([["Ignored", 10], ["Pending", 2], ["Survived", 3], ["CompileError", 1]]);
  const comparison = compareReports(base, head);
  expect(comparison.regression).toBe(false);
  expect(comparison.moves.map((move) => [move.location.start.line, move.from, move.to])).toEqual([
    [1, "Killed", "CompileError"],
    [2, "Killed", "Pending"],
    [3, "Pending", "Survived"],
    [10, "Killed", "Ignored"],
  ]);
  expect(formatComparison(comparison, false)).toContain("moved src/a.ts:10:1");
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
