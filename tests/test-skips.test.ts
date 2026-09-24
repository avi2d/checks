import { expect, test } from "bun:test";
import { judgeSkips, passes, report } from "../scripts/test.ts";
import type { TestResult } from "../scripts/test-report.ts";

function skipped(file: string, line: number, name: string): TestResult {
  return { file, line, name, outcome: "skipped" };
}

test("undeclared skips read in file and line order whatever order the randomized run took", () => {
  const results = [skipped("tests/b.test.ts", 3, "b3"), skipped("tests/a.test.ts", 9, "a9"), skipped("tests/a.test.ts", 2, "a2")];
  const verdict = judgeSkips(results, [], "local");
  expect(verdict.undeclared.map((result) => result.name)).toEqual(["a2", "a9", "b3"]);
  expect(passes(verdict)).toBe(false);
});

test("one declaration covers every skipped test sharing its file and name, and nothing in another file", () => {
  const results = [skipped("tests/a.test.ts", 2, "each"), skipped("tests/a.test.ts", 2, "each"), skipped("tests/b.test.ts", 2, "each")];
  const verdict = judgeSkips(results, [{ file: "tests/a.test.ts", test: "each", reason: "a reason" }], "ci");
  expect(verdict.undeclared).toEqual([skipped("tests/b.test.ts", 2, "each")]);
  expect(verdict.stale).toEqual([]);
});

test("a declaration for the other environment is neither required nor stale, and the pass line counts it", () => {
  const declarations = [
    { file: "tests/a.test.ts", test: "needs a secret", reason: "only CI holds it", when: "local" as const },
    { file: "tests/a.test.ts", test: "needs a daemon", reason: "CI has none", when: "ci" as const },
  ];
  const verdict = judgeSkips([skipped("tests/a.test.ts", 4, "needs a daemon")], declarations, "ci");
  expect(passes(verdict)).toBe(true);
  expect(report(verdict)).toBe(
    "checks-test: 1 skipped test(s), each declared in package.json testSkips; 1 declaration(s) for local not judged in this ci run",
  );
});

test("a stale declaration fails a ci run and names the declaration", () => {
  const verdict = judgeSkips([], [{ file: "tests/a.test.ts", test: "gone", reason: "a reason" }], "ci");
  expect(passes(verdict)).toBe(false);
  expect(report(verdict)).toBe(
    [
      "checks-test: 0 skipped test(s) undeclared and 1 declaration(s) matching no skipped test in this ci run:",
      "  tests/a.test.ts > gone: declared, but no such test skipped; delete the declaration",
    ].join("\n"),
  );
});

test("a stale declaration passes a local run with a warning, and an undeclared skip still fails it", () => {
  const declarations = [{ file: "tests/a.test.ts", test: "gone", reason: "a reason" }];
  const warned = judgeSkips([], declarations, "local");
  expect(passes(warned)).toBe(true);
  expect(report(warned)).toBe(
    [
      "checks-test: no test skipped",
      "checks-test: warning: 1 declaration(s) matching no skipped test in this local run, refused only in a ci run:",
      "  tests/a.test.ts > gone: declared, but no such test skipped; delete the declaration",
    ].join("\n"),
  );

  const refused = judgeSkips([skipped("tests/a.test.ts", 2, "new")], declarations, "local");
  expect(passes(refused)).toBe(false);
  expect(report(refused)).toBe(
    [
      "checks-test: 1 skipped test(s) undeclared in this local run:",
      "  tests/a.test.ts:2 new: skipped with no declaration; run it, or declare it in package.json testSkips with its reason",
      "checks-test: warning: 1 declaration(s) matching no skipped test in this local run, refused only in a ci run:",
      "  tests/a.test.ts > gone: declared, but no such test skipped; delete the declaration",
    ].join("\n"),
  );
});
