import { expect, test } from "bun:test";
import { judgeSkips, passes, report } from "../scripts/test.ts";
import { skipReason, type SkipDeclaration } from "../scripts/test-skips.ts";
import type { TestResult } from "../scripts/test-report.ts";

function declaration(file: string, line: number, reason: string, when?: "ci" | "local"): SkipDeclaration {
  return { scope: "test", file, line, name: "rounds half to even", reason, ...(when === undefined ? {} : { when }) };
}

function result(file: string, line: number, name: string, outcome: TestResult["outcome"]): TestResult {
  return { file, line, name, outcome };
}

const SKIPPED = result("tests/pricing.test.ts", 12, "rounds half to even", "skipped");

test("skipReason leaves the test name unchanged", () => {
  expect(skipReason("waits for the rounding fix", "rounds half to even")).toBe("rounds half to even");
});

test("a skipped test passes only when the same source line declares its reason under its name", () => {
  const declared = judgeSkips([SKIPPED], [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")], "ci");
  expect(passes(declared)).toBe(true);
  expect(report(declared)).toBe("checks-test: 1 skipped test(s), each declared at its test site");

  const wrongLine = judgeSkips([SKIPPED], [declaration("tests/pricing.test.ts", 13, "waits for the rounding fix")], "ci");
  expect(passes(wrongLine)).toBe(false);
  expect(wrongLine.undeclared).toEqual([SKIPPED]);

  const renamed = result("tests/pricing.test.ts", 12, "rounds half up", "skipped");
  const wrongName = judgeSkips([renamed], [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")], "ci");
  expect(wrongName.undeclared).toEqual([renamed]);
});

test("a declared test inside a describe keeps the describe path in its name", () => {
  const nested = result("tests/pricing.test.ts", 12, "totals > rounds half to even", "skipped");
  const verdict = judgeSkips([nested], [declaration("tests/pricing.test.ts", 12, "waits for the rounding fix")], "ci");
  expect(passes(verdict)).toBe(true);
});

test("a describe declaration covers every test inside its lines", () => {
  const group: SkipDeclaration = {
    scope: "describe",
    file: "tests/pricing.test.ts",
    line: 10,
    lastLine: 20,
    nestedSkips: [{ line: 16, lastLine: 18 }],
    name: "totals",
    reason: "waits for the rounding fix",
  };
  const inner = [
    result("tests/pricing.test.ts", 11, "totals > rounds half to even", "skipped"),
    result("tests/pricing.test.ts", 14, "outer > totals > deeper > sums", "skipped"),
  ];
  expect(passes(judgeSkips(inner, [group], "ci"))).toBe(true);

  const outside = result("tests/pricing.test.ts", 21, "totals > later", "skipped");
  expect(judgeSkips([...inner, outside], [group], "ci").undeclared).toEqual([outside]);

  const ownSkip = result("tests/pricing.test.ts", 17, "totals > nested > skips itself", "skipped");
  expect(judgeSkips([...inner, ownSkip], [group], "ci").undeclared).toEqual([ownSkip]);

  const ran = inner.map((skipped) => ({ ...skipped, outcome: "passed" as const }));
  expect(judgeSkips(ran, [group], "ci").stale).toEqual([group]);
});

test("a declared todo passes and an undeclared skip or todo fails", () => {
  const todo = result("tests/pricing.test.ts", 12, "rounds half to even", "todo");
  expect(passes(judgeSkips([todo], [declaration("tests/pricing.test.ts", 12, "needs the tax table")], "ci"))).toBe(true);

  const native = result("tests/pricing.test.ts", 12, "rounds half to even", "skipped");
  const undeclaredTodo = result("tests/pricing.test.ts", 13, "refunds a partial order", "todo");
  const verdict = judgeSkips([native, undeclaredTodo], [], "local");
  expect(passes(verdict)).toBe(false);
  expect(report(verdict)).toContain("rounds half to even: skipped with no reason at its test site");
  expect(report(verdict)).toContain(
    "refunds a partial order: a todo with no reason at its test site; use test.todo(skipReason(reason, name))",
  );
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
  const passed = result("tests/pricing.test.ts", 12, "rounds half to even", "passed");
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
