import { expect, test } from "bun:test";
import {
  changedFiles,
  entryOptions,
  scriptOptions,
  selectSuite,
  smokeList,
  suiteArgs,
  testOptions,
} from "../../src/testing/test.ts";
import { scriptViolations } from "../../src/testing/test-layout.ts";
import { smokeFiles } from "../../src/testing/test-skips.ts";

test("outside CI the default run is the unit tier plus the smoke list", () => {
  expect(selectSuite({}, "local")).toEqual({ kind: "smoke" });
  expect(suiteArgs({ kind: "smoke" }, ["tests/e2e/checkout.test.ts"])).toEqual([
    "./tests/unit",
    "./tests/e2e/checkout.test.ts",
  ]);
});

test("outside CI an empty smoke list still runs the unit tier", () => {
  expect(suiteArgs({ kind: "smoke" }, [])).toEqual(["./tests/unit"]);
});

test("under CI the default run is the full suite", () => {
  expect(selectSuite({}, "ci")).toEqual({ kind: "full" });
  expect(suiteArgs({ kind: "full" }, ["tests/e2e/checkout.test.ts"])).toEqual([]);
});

test("--full runs the full suite outside CI", () => {
  expect(testOptions(["--full"])).toEqual({ full: true });
  expect(selectSuite({ full: true }, "local")).toEqual({ kind: "full" });
  expect(suiteArgs(selectSuite({ full: true }, "local"), [])).toEqual([]);
});

test("--full runs the same full suite under CI", () => {
  expect(selectSuite({ full: true }, "ci")).toEqual({ kind: "full" });
});

test("--full combines with a worker count and a junit file but never with a tier", () => {
  expect(testOptions(["--parallel=4", "--full"])).toEqual({ workers: 4, full: true });
  expect(entryOptions(["--full", "--junit=reports/suite.xml"])).toEqual({
    options: { full: true },
    junit: expect.anything(),
    changed: false,
  });
  expect(testOptions(["--tier=e2e", "--full"])).toBeUndefined();
  expect(testOptions(["--full", "--full"])).toBeUndefined();
});

test("--changed combines with a worker count and a junit file, while a tier, --full or a second --changed is refused", () => {
  expect(entryOptions(["--changed", "--parallel=3"])).toEqual({ options: { workers: 3 }, junit: expect.anything(), changed: true });
  expect(entryOptions(["--junit=reports/fast.xml", "--changed"])?.changed).toBe(true);
  expect(entryOptions(["--changed", "--tier=unit"])).toBeUndefined();
  expect(entryOptions(["--changed", "--full"])).toBeUndefined();
  expect(entryOptions(["--changed", "--changed"])).toBeUndefined();
});

test("a test script never takes --changed, so scripts.test cannot shrink the CI suite to the changed files", () => {
  expect(scriptOptions("checks-test --changed")).toBeUndefined();
  expect(scriptViolations({ scripts: { test: "checks-test --changed", lint: "checks-lint" } }).map((violation) => violation.message)).toEqual([
    'scripts.test must be "checks-test", optionally with --parallel=<workers>, which runs bun test --randomize and judges its skips, found "checks-test --changed"',
  ]);
});

test("a --changed run passes the unit level and each touched e2e file to bun test, rather than the whole e2e level", () => {
  expect(suiteArgs({ kind: "changed", e2e: ["tests/e2e/docs.test.ts"] }, [])).toEqual(["./tests/unit", "./tests/e2e/docs.test.ts"]);
  expect(suiteArgs({ kind: "changed", e2e: [] }, ["tests/e2e/smoke.test.ts"])).toEqual(["./tests/unit"]);
});

test("a --changed run judges the unit tests and the touched e2e files, not a quarantined, live or untouched test", () => {
  expect(changedFiles([
    "tests/e2e/docs.test.ts",
    "tests/e2e/release.test.ts",
    "tests/live/browser.test.ts",
    "tests/quarantine/unit/flaky.test.ts",
    "tests/unit/test.test.ts",
  ], ["tests/e2e/docs.test.ts"])).toEqual(["tests/e2e/docs.test.ts", "tests/unit/test.test.ts"]);
});

test("an explicit tier still runs only that tier in either environment", () => {
  expect(selectSuite({ tier: "e2e" }, "local")).toEqual({ kind: "tier", tier: "e2e" });
  expect(selectSuite({ tier: "unit" }, "ci")).toEqual({ kind: "tier", tier: "unit" });
  expect(suiteArgs({ kind: "tier", tier: "unit" }, [])).toEqual(["./tests/unit"]);
  expect(suiteArgs({ kind: "tier", tier: "live" }, [])).toEqual([
    "--path-ignore-patterns",
    "",
    "./tests/live",
  ]);
});

test("the smoke list lives under checks.smoke in package.json and defaults to empty", () => {
  expect(smokeList({})).toEqual([]);
  expect(smokeList({ scripts: { test: "checks-test" } })).toEqual([]);
  expect(smokeList({ checks: {} })).toEqual([]);
  expect(smokeList({ checks: { smoke: [] } })).toEqual([]);
  expect(smokeList({ checks: { smoke: ["tests/e2e/checkout.test.ts"] } })).toEqual([
    "tests/e2e/checkout.test.ts",
  ]);
});

test("a smoke list of the wrong shape is refused", () => {
  expect(smokeList({ checks: null })).toBeUndefined();
  expect(smokeList({ checks: { smoke: "tests/e2e/checkout.test.ts" } })).toBeUndefined();
  expect(smokeList({ checks: { smoke: [""] } })).toBeUndefined();
  expect(smokeList({ checks: { smoke: [42] } })).toBeUndefined();
});

test("the smoke scope is the unit tier plus the declared files", () => {
  const scoped = smokeFiles(
    ["tests/unit/a.test.ts", "tests/e2e/b.test.ts", "tests/live/c.test.ts"],
    ["tests/e2e/b.test.ts"],
  );
  expect(scoped).toEqual({ kind: "valid", files: ["tests/unit/a.test.ts", "tests/e2e/b.test.ts"] });
});

test("a smoke entry that names no test file is refused", () => {
  expect(smokeFiles(["tests/unit/a.test.ts"], ["tests/e2e/nope.test.ts"])).toEqual({
    kind: "invalid",
    message: "checks.smoke names no test file at tests/e2e/nope.test.ts",
  });
});

test("a smoke entry never names a test Bun's ignored paths drop", () => {
  for (const file of ["tests/quarantine/unit/q.test.ts", "tests/live/l.test.ts", "tests/pixel/p.test.ts"]) {
    expect(smokeFiles([file], [file])).toEqual({
      kind: "invalid",
      message: `checks.smoke cannot name a quarantined, live or pixel test at ${file}`,
    });
  }
});

test("scripts.test never forces the full suite, so a local run stays capped", () => {
  expect(scriptOptions("checks-test --full")).toEqual({ full: true });
  expect(
    scriptViolations({ scripts: { test: "checks-test --full", lint: "checks-lint" } }),
  ).toHaveLength(1);
  expect(
    scriptViolations({ scripts: { test: "checks-test", lint: "checks-lint" } }),
  ).toBeEmpty();
});
