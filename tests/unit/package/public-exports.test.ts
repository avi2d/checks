import { expect, test } from "bun:test";
import * as git from "@avi2dg/checks/core/git.ts";
import { type Change } from "@avi2dg/checks/core/git.ts";
import * as main from "@avi2dg/checks/core/main.ts";
import * as bunPlatform from "@avi2dg/checks/core/bun-platform.ts";
import * as chromePath from "@avi2dg/checks/core/chrome-path.ts";
import * as commandOutput from "@avi2dg/checks/core/command-output.ts";
import * as runEffect from "@avi2dg/checks/testing/run-effect.ts";
import * as gitleaks from "@avi2dg/checks/delivery/gitleaks.ts";
import * as cacheRoot from "@avi2dg/checks/dependencies/cache-root.ts";
import * as testGate from "@avi2dg/checks/testing/test.ts";
import * as testReport from "@avi2dg/checks/testing/test-report.ts";
import * as testSkips from "@avi2dg/checks/scripts/test-skips.ts";
import { type Environment } from "@avi2dg/checks/scripts/test-skips.ts";
import * as gitSource from "../../../src/core/git.ts";
import * as gitleaksSource from "../../../src/delivery/gitleaks.ts";
import * as cacheRootSource from "../../../src/dependencies/cache-root.ts";
import * as mainSource from "../../../src/core/main.ts";
import * as bunPlatformSource from "../../../src/core/bun-platform.ts";
import * as chromePathSource from "../../../src/core/chrome-path.ts";
import * as commandOutputSource from "../../../src/core/command-output.ts";
import * as runEffectSource from "../../../src/testing/run-effect.ts";
import * as testReportSource from "../../../src/testing/test-report.ts";
import * as testSource from "../../../src/testing/test.ts";
import * as testSkipsSource from "../../../src/testing/test-skips.ts";

const published = [
  { subpath: "core/git.ts", module: git, source: gitSource, names: ["changedPaths", "defaultBranch", "git", "rangeEnds"] },
  { subpath: "core/main.ts", module: main, source: mainSource, names: ["runMain", "Usage"] },
  { subpath: "core/bun-platform.ts", module: bunPlatform, source: bunPlatformSource, names: ["main"] },
  { subpath: "core/chrome-path.ts", module: chromePath, source: chromePathSource, names: ["chromePath", "ChromeNotFound"] },
  { subpath: "core/command-output.ts", module: commandOutput, source: commandOutputSource, names: ["outputOf"] },
  { subpath: "testing/run-effect.ts", module: runEffect, source: runEffectSource, names: ["run"] },
  { subpath: "delivery/gitleaks.ts", module: gitleaks, source: gitleaksSource, names: ["gitleaksBuildFor", "pinnedGitleaks", "scanCommits", "scanDirectory"] },
  { subpath: "dependencies/cache-root.ts", module: cacheRoot, source: cacheRootSource, names: ["cacheRoot"] },
  { subpath: "testing/test-report.ts", module: testReport, source: testReportSource, names: ["parseReport", "reporterArgs", "ReportError"] },
  { subpath: "testing/test.ts", module: testGate, source: testSource, names: ["judgeSkips", "passes", "report", "SkipGateError"] },
  { subpath: "scripts/test-skips.ts", module: testSkips, source: testSkipsSource, names: ["readSkipDeclarations"] },
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
