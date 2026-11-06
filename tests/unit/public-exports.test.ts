import { expect, test } from "bun:test";
import * as git from "@avi2dg/checks/core/git";
import { type Change } from "@avi2dg/checks/core/git";
import * as main from "@avi2dg/checks/core/main";
import * as testGate from "@avi2dg/checks/testing/test";
import * as testReport from "@avi2dg/checks/testing/test-report";
import * as testSkips from "@avi2dg/checks/testing/test-skips";
import { type Environment } from "@avi2dg/checks/testing/test-skips";
import * as gitSource from "../../src/core/git.ts";
import * as mainSource from "../../src/core/main.ts";
import * as testReportSource from "../../src/testing/test-report.ts";
import * as testSource from "../../src/testing/test.ts";
import * as testSkipsSource from "../../src/testing/test-skips.ts";

const published = [
  { subpath: "core/git", module: git, source: gitSource, names: ["changedPaths", "defaultBranch", "git", "rangeEnds"] },
  { subpath: "core/main", module: main, source: mainSource, names: ["runMain", "Usage"] },
  { subpath: "testing/test-report", module: testReport, source: testReportSource, names: ["parseReport", "reporterArgs", "ReportError"] },
  { subpath: "testing/test", module: testGate, source: testSource, names: ["judgeSkips", "passes", "report", "SkipGateError"] },
  { subpath: "testing/test-skips", module: testSkips, source: testSkipsSource, names: ["readSkipDeclarations"] },
];

test.each(published)("$subpath publishes the very helpers its source file defines, not a missing or stand-in export", ({ module, source, names }) => {
  const exported = Object.fromEntries(Object.entries(module));
  const defined = Object.fromEntries(Object.entries(source));
  for (const name of names) {
    expect(exported[name]).toBeFunction();
    expect(exported[name]).toBe(defined[name]);
  }
});

test("the published Change and Environment types carry a rename and a ci run through the helpers without the checks-test CLI running on import", () => {
  const change: Change = { kind: "renamed", from: "a.ts", path: "b.ts", edited: false };
  const environment: Environment = "ci";
  expect(git.pathsOf(change)).toEqual(["a.ts", "b.ts"]);
  const verdict = testGate.judgeSkips([], [], environment);
  expect(testGate.passes(verdict)).toBe(true);
  expect(testGate.report(verdict)).toBe("checks-test: no test skipped");
});
