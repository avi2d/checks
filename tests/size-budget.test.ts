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
  verdictLines,
  verdictOf,
  type Growth,
  type Site,
  type Verdict,
} from "../scripts/size-budget.ts";

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

test("growthsOf judges each rule per file, so a shrink in one rule or file never offsets a growth in another", () => {
  const baseFunctionLines = site("src/wide.ts", "max-lines-per-function", 4);
  const baseFileLines = site("src/wide.ts", "max-lines", 14);
  const headFunctionLines = site("src/wide.ts", "max-lines-per-function", 1);
  const headFileLines = site("src/wide.ts", "max-lines", 39);
  const growths = growthsOf([headFunctionLines, headFileLines], [baseFunctionLines, baseFileLines]);
  expect(growths).toEqual([{ file: "src/wide.ts", rule: "max-lines", counts: "overrun", base: 14, head: 39, sites: [headFileLines] }]);
});

test("growthsOf reports no growth for a lowered or unchanged overrun, and every site of a newly appeared rule", () => {
  const base: readonly Site[] = [site("src/legacy.ts", "max-lines", 10)];
  expect(growthsOf(base, base)).toEqual([]);
  expect(growthsOf([site("src/legacy.ts", "max-lines", 5)], base)).toEqual([]);
  const appeared = [site("src/fresh.ts", "max-lines-per-function", 7)];
  expect(growthsOf(appeared, [])).toEqual([{ file: "src/fresh.ts", rule: "max-lines-per-function", counts: "sites", base: 0, head: 1, sites: appeared }]);
});

function over(name: string, overrun: number, line = 1): Site {
  return { file: "src/a.ts", line, rule: "max-lines-per-function", overrun, message: `The function \`${name}\` has too many lines (${overrun + 5}). Maximum allowed is 5.` };
}

test("growthsOf never sums sites, so trimming one function cannot pay for a new one", () => {
  const trimmed = over("f", 10);
  const added = over("g", 20, 40);
  expect(growthsOf([trimmed, added], [over("f", 30)])).toEqual([
    { file: "src/a.ts", rule: "max-lines-per-function", counts: "sites", base: 1, head: 2, sites: [trimmed, added] },
  ]);
});

test("growthsOf fails a function that grew past the same function at the base, and passes a renamed or shrunk one", () => {
  const grown = over("f", 12);
  expect(growthsOf([grown, over("g", 3)], [over("f", 10), over("g", 5)])).toEqual([
    { file: "src/a.ts", rule: "max-lines-per-function", counts: "overrun", base: 10, head: 12, sites: [grown] },
  ]);
  expect(growthsOf([over("h", 10)], [over("f", 10)])).toEqual([]);
});

test("siteOf reads a whole-file overrun against the limit oxlint gives in its help", () => {
  const diagnostic = {
    code: "eslint(max-lines)",
    message: "File has too many lines (30).",
    help: "Maximum allowed is 20.",
    filename: "src/legacy.ts",
    labels: [{ span: { line: 30 } }],
  };
  expect(Effect.runSync(siteOf(diagnostic))).toEqual([
    { file: "src/legacy.ts", line: undefined, rule: "max-lines", overrun: 10, message: "File has too many lines (30). Maximum allowed is 20." },
  ]);
});

test("siteOf keeps a function's line and unadorned message, and drops a diagnostic no size rule owns", () => {
  const diagnostic = {
    code: "eslint(max-lines-per-function)",
    message: "The function `count` has too many lines (12). Maximum allowed is 5.",
    filename: "src/fresh.ts",
    labels: [{ span: { line: 1 } }],
  };
  expect(Effect.runSync(siteOf(diagnostic))).toEqual([
    { file: "src/fresh.ts", line: 1, rule: "max-lines-per-function", overrun: 7, message: diagnostic.message },
  ]);

  const foreign = { ...diagnostic, code: "eslint(no-debugger)" };
  expect(Effect.runSync(siteOf(foreign))).toEqual([]);
});

test("siteOf refuses a diagnostic it cannot read a count or a limit from", () => {
  const diagnostic = { code: "eslint(max-lines)", message: "File has too many lines.", help: "Maximum allowed is 20.", filename: "src/legacy.ts" };
  expect(() => Effect.runSync(siteOf(diagnostic))).toThrow("cannot read max-lines for src/legacy.ts from oxlint");
  const unlimited = { ...diagnostic, message: "File has too many lines (30).", help: "" };
  expect(() => Effect.runSync(siteOf(unlimited))).toThrow("cannot read max-lines for src/legacy.ts from oxlint");
});

test("verdictOf holds only what the range held, judged against the same file and rule at the base", () => {
  const heldSite = site("src/fresh.ts", "max-lines-per-function", 7);
  const advisorySite = site("tools/long.ts", "max-lines", 10);
  const verdict = verdictOf(1, new Set(["src/fresh.ts"]), [heldSite, advisorySite], []);
  expect(verdict).toEqual({
    held: 1,
    growths: [{ file: "src/fresh.ts", rule: "max-lines-per-function", counts: "sites", base: 0, head: 1, sites: [heldSite] }],
    advisory: [advisorySite],
  });
});

test("passes holds on an empty growth list and fails otherwise", () => {
  expect(passes({ held: 0, growths: [], advisory: [] })).toBe(true);
  const growth: Growth = { file: "a.ts", rule: "max-lines", counts: "sites", base: 0, head: 1, sites: [] };
  expect(passes({ held: 1, growths: [growth], advisory: [] })).toBe(false);
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
    held: 1,
    growths: [
      { file: "src/fresh.ts", rule: "max-lines-per-function", counts: "sites", base: 0, head: 1, sites: [growthSite] },
      { file: "src/legacy.ts", rule: "max-lines", counts: "overrun", base: 8, head: 10, sites: [] },
    ],
    advisory: [advisorySite],
  };
  expect(report(verdict)).toBe(
    [
      "size-budget: 2 overrun(s) grew past the base in the files the range adds or changes:",
      "  src/fresh.ts: max-lines-per-function over at 1 site(s), up from 0",
      "    src/fresh.ts:1: The function `count` has too many lines (12). Maximum allowed is 5.",
      "  src/legacy.ts: max-lines over by 10, up from 8",
      "size-budget: advisory, 1 overrun(s) where the budget does not hold yet:",
      "  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.",
    ].join("\n"),
  );
});

test("verdictLines reports success with the count of held files", () => {
  expect(verdictLines({ held: 2, growths: [], advisory: [] })).toEqual([
    "size-budget: 2 file(s), the files the range adds or changes, raise no overrun past the base",
  ]);
});
