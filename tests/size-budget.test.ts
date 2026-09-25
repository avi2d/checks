import { Effect } from "effect";
import { expect, test } from "bun:test";
import type { Change } from "../scripts/git.ts";
import {
  describe,
  growthsOf,
  heldByChange,
  passes,
  report,
  siteOf,
  sizeConfig,
  verdictLines,
  verdictOf,
  type Growth,
  type Site,
  type Verdict,
} from "../scripts/size-budget.ts";
import { budgetsOf } from "../scripts/size-rules.ts";

const BUDGETS = budgetsOf({ production: { fileLines: 20, functionLines: 5 } });

function site(file: string, rule: Site["rule"], overrun: number, message = `${file} is over`): Site {
  const line = rule === "max-lines" ? undefined : 1;
  return { file, line, rule, overrun, message };
}

test("heldByChange holds a written file, an edited rename by its new path, but not a deletion or an unedited rename", () => {
  const changes: readonly Change[] = [
    { kind: "written", path: "src/a.ts" },
    { kind: "deleted", path: "src/gone.ts" },
    { kind: "renamed", from: "src/old.ts", path: "src/new.ts", edited: true },
    { kind: "renamed", from: "src/moved.ts", path: "src/lib/moved.ts", edited: false },
  ];
  expect(heldByChange(changes)).toEqual([
    { path: "src/a.ts", from: "src/a.ts" },
    { path: "src/new.ts", from: "src/old.ts" },
  ]);
});

test("growthsOf sums each rule per file, so a shrink in one rule or file never offsets a growth in another", () => {
  const baseFunctionLines = site("src/wide.ts", "max-lines-per-function", 4);
  const baseFileLines = site("src/wide.ts", "max-lines", 14);
  const headFunctionLines = site("src/wide.ts", "max-lines-per-function", 1);
  const headFileLines = site("src/wide.ts", "max-lines", 39);
  const growths = growthsOf([headFunctionLines, headFileLines], [baseFunctionLines, baseFileLines]);
  expect(growths).toEqual([{ file: "src/wide.ts", rule: "max-lines", base: 14, head: 39, sites: [headFileLines] }]);
});

test("growthsOf reports no growth for a lowered or unchanged sum, and every site of a newly appeared rule", () => {
  const base: readonly Site[] = [site("src/legacy.ts", "max-lines", 10)];
  expect(growthsOf(base, base)).toEqual([]);
  expect(growthsOf([site("src/legacy.ts", "max-lines", 5)], base)).toEqual([]);
  const appeared = [site("src/fresh.ts", "max-lines-per-function", 7)];
  expect(growthsOf(appeared, [])).toEqual([{ file: "src/fresh.ts", rule: "max-lines-per-function", base: 0, head: 7, sites: appeared }]);
});

test("siteOf reads a matching diagnostic's overrun against the file's budget, tests held to their own", () => {
  const diagnostic = {
    code: "eslint(max-lines)",
    message: "File has too many lines (30).",
    filename: "src/legacy.ts",
    labels: [],
  };
  expect(Effect.runSync(siteOf(BUDGETS)(diagnostic))).toEqual([
    { file: "src/legacy.ts", line: undefined, rule: "max-lines", overrun: 10, message: "File has too many lines (30). Maximum allowed is 20." },
  ]);

  const testDiagnostic = { ...diagnostic, filename: "tests/wide.test.ts", message: "File has too many lines (25)." };
  expect(Effect.runSync(siteOf(BUDGETS)(testDiagnostic))).toEqual([
    { file: "tests/wide.test.ts", line: undefined, rule: "max-lines", overrun: -575, message: "File has too many lines (25). Maximum allowed is 600." },
  ]);
});

test("siteOf keeps a function's line and unadorned message, and drops a diagnostic no size rule owns", () => {
  const diagnostic = {
    code: "eslint(max-lines-per-function)",
    message: "The function `count` has too many lines (12). Maximum allowed is 5.",
    filename: "src/fresh.ts",
    labels: [{ span: { line: 1 } }],
  };
  expect(Effect.runSync(siteOf(BUDGETS)(diagnostic))).toEqual([
    { file: "src/fresh.ts", line: 1, rule: "max-lines-per-function", overrun: 7, message: diagnostic.message },
  ]);

  const foreign = { ...diagnostic, code: "eslint(no-debugger)" };
  expect(Effect.runSync(siteOf(BUDGETS)(foreign))).toEqual([]);
});

test("siteOf refuses a diagnostic whose message it cannot read a count from", () => {
  const diagnostic = { code: "eslint(max-lines)", message: "File has too many lines.", filename: "src/legacy.ts", labels: [] };
  expect(() => Effect.runSync(siteOf(BUDGETS)(diagnostic))).toThrow("cannot read max-lines for src/legacy.ts from oxlint");
});

test("verdictOf under ratchet holds only what the range held, judged against the same file and rule at the base", () => {
  const heldSite = site("src/fresh.ts", "max-lines-per-function", 7);
  const advisorySite = site("tools/long.ts", "max-lines", 10);
  const verdict = verdictOf("ratchet", 1, new Set(["src/fresh.ts"]), [heldSite, advisorySite], []);
  expect(verdict).toEqual({
    applies: "ratchet",
    held: 1,
    growths: [{ file: "src/fresh.ts", rule: "max-lines-per-function", base: 0, head: 7, sites: [heldSite] }],
    advisory: [advisorySite],
  });
});

test("verdictOf under all holds every site, tallying the ones outside the held set as advisory", () => {
  const heldSite = site("src/legacy.ts", "max-lines", 10);
  const advisorySite = site("tools/long.ts", "max-lines", 10);
  const verdict = verdictOf("all", 2, new Set(["src/legacy.ts", "src/small.ts"]), [heldSite, advisorySite], []);
  expect(verdict).toEqual({ applies: "all", held: 2, overruns: [heldSite], advisory: [advisorySite] });
});

test("passes holds on an empty ratchet growth list or an empty all overrun list, and fails otherwise", () => {
  expect(passes({ applies: "ratchet", held: 0, growths: [], advisory: [] })).toBe(true);
  expect(passes({ applies: "all", held: 0, overruns: [], advisory: [] })).toBe(true);
  const growth: Growth = { file: "a.ts", rule: "max-lines", base: 0, head: 1, sites: [] };
  expect(passes({ applies: "ratchet", held: 1, growths: [growth], advisory: [] })).toBe(false);
});

test("describe renders a whole-file site without a line, and a per-function site with one", () => {
  expect(describe({ file: "src/legacy.ts", line: undefined, rule: "max-lines", overrun: 10, message: "too many lines" })).toBe(
    "  src/legacy.ts: too many lines",
  );
  expect(describe({ file: "src/fresh.ts", line: 1, rule: "max-lines-per-function", overrun: 7, message: "too many lines" }, "    ")).toBe(
    "    src/fresh.ts:1: too many lines",
  );
});

test("report renders a ratchet growth, its sites, and the advisory notice beneath it", () => {
  const growthSite = site("src/fresh.ts", "max-lines-per-function", 7, "The function `count` has too many lines (12). Maximum allowed is 5.");
  const advisorySite = site("src/legacy.ts", "max-lines", 10, "File has too many lines (30). Maximum allowed is 20.");
  const verdict: Verdict = {
    applies: "ratchet",
    held: 1,
    growths: [{ file: "src/fresh.ts", rule: "max-lines-per-function", base: 0, head: 7, sites: [growthSite] }],
    advisory: [advisorySite],
  };
  expect(report(verdict)).toBe(
    [
      "size-budget: 1 overrun(s) grew past the base in the production and test files the range adds or changes:",
      "  src/fresh.ts: max-lines-per-function over by 7 in total, up from 0",
      "    src/fresh.ts:1: The function `count` has too many lines (12). Maximum allowed is 5.",
      "size-budget: advisory, 1 overrun(s) where the budget does not hold yet:",
      "  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.",
    ].join("\n"),
  );
});

test("verdictLines reports success by scope, and the all-mode overrun listing", () => {
  expect(verdictLines({ applies: "ratchet", held: 2, growths: [], advisory: [] })).toEqual([
    "size-budget: 2 file(s), the production and test files the range adds or changes, raise no overrun past the base",
  ]);
  const overrun = site("src/legacy.ts", "max-lines", 10, "File has too many lines (30). Maximum allowed is 20.");
  expect(verdictLines({ applies: "all", held: 1, overruns: [overrun], advisory: [] })).toEqual([
    "size-budget: 1 overrun(s) of the budget in every production and test file:",
    "  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.",
  ]);
});

test("sizeConfig turns the kit's default budget into oxlint rules, the plugin's by its qualified name, and tests/ into their own", () => {
  const counted = { skipBlankLines: false, skipComments: false };
  const config = sizeConfig(budgetsOf({}), "/kit/dist/index.js");
  expect(config.jsPlugins).toEqual(["/kit/dist/index.js"]);
  expect(config.rules).toEqual({
    "max-lines": ["error", { max: 400, ...counted }],
    "max-lines-per-function": ["error", { max: 100, ...counted }],
    "max-statements": ["error", { max: 30 }],
    "effect-channel/cognitive-complexity": ["error", { max: 15 }],
    "max-depth": ["error", { max: 4 }],
  });
  expect(config.overrides).toEqual([
    {
      files: ["tests/**"],
      rules: {
        "max-lines": ["error", { max: 600, ...counted }],
        "max-lines-per-function": "off",
        "max-statements": ["error", { max: 50 }],
        "effect-channel/cognitive-complexity": ["error", { max: 15 }],
        "max-depth": ["error", { max: 4 }],
      },
    },
  ]);
});
