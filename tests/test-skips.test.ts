import { expect, test } from "bun:test";
import { judgeSkips, passes, report } from "../scripts/test.ts";
import { stripInlineSkip, type SkipDeclaration } from "../scripts/test-skips.ts";
import type { TestResult } from "../scripts/test-report.ts";

function declaration(file: string, line: number, reason: string, when?: "ci" | "local"): SkipDeclaration {
  return { file, line, reason, ...(when === undefined ? {} : { when }) };
}

function result(file: string, line: number, name: string, outcome: TestResult["outcome"]): TestResult {
  return { file, line, name, outcome };
}

const SITE_NAME = 'rounds half to even [checks skip: "waits for the rounding fix"]';
const SKIPPED = result("tests/pricing.test.ts", 12, SITE_NAME, "skipped");

test("a skipped test passes only when the same source line declares its reason", () => {
  const declared = judgeSkips([SKIPPED], [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")], "ci");
  expect(passes(declared)).toBe(true);
  expect(report(declared)).toBe("checks-test: 1 skipped test(s), each declared at its test site");

  const wrongLine = judgeSkips([SKIPPED], [declaration("tests/pricing.test.ts", 13, "waits for the rounding fix")], "ci");
  expect(passes(wrongLine)).toBe(false);
  expect(wrongLine.undeclared).toEqual([SKIPPED]);
});

test("a native skip without a site reason and a todo both fail", () => {
  const native = result("tests/pricing.test.ts", 12, "rounds half to even", "skipped");
  const todo = result("tests/pricing.test.ts", 13, "refunds a partial order", "todo");
  const verdict = judgeSkips([native, todo], [], "local");
  expect(passes(verdict)).toBe(false);
  expect(report(verdict)).toContain("rounds half to even: skipped with no reason at its test site");
  expect(report(verdict)).toContain("refunds a partial order: a todo is not allowed; implement it or remove test.todo");
});

test("a declaration without a skipped test fails in CI and warns locally", () => {
  const declarations = [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")];
  const ci = judgeSkips([], declarations, "ci");
  expect(passes(ci)).toBe(false);
  expect(report(ci)).toContain("tests/pricing.test.ts:12: no test skipped with this declaration");

  const local = judgeSkips([], declarations, "local");
  expect(passes(local)).toBe(true);
  expect(report(local)).toContain("warning: 1 declaration(s) matching no skipped test");
});

test("a test that stopped skipping leaves a stale declaration", () => {
  const passed = result("tests/pricing.test.ts", 12, SITE_NAME, "passed");
  const declarations = [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")];
  expect(passes(judgeSkips([passed], declarations, "ci"))).toBe(false);
  expect(passes(judgeSkips([passed], declarations, "local"))).toBe(true);
});

test("a declaration for one environment is not stale in the other", () => {
  const ciOnly = declaration("tests/pricing.test.ts", 12, "CI has no daemon", "ci");
  const ci = judgeSkips([SKIPPED], [ciOnly], "ci");
  expect(passes(ci)).toBe(true);
  expect(report(ci)).toContain("checks-test: 1 skipped test(s), each declared at its test site");

  const local = judgeSkips([], [ciOnly], "local");
  expect(passes(local)).toBe(true);
  expect(report(local)).toContain("1 declaration(s) for ci not judged in this local run");
});

test("the inline marker strips from a test name without changing an ordinary name", () => {
  expect(stripInlineSkip(SITE_NAME)).toBe("rounds half to even");
  expect(stripInlineSkip("rounds half to even")).toBeUndefined();
});
