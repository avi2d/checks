import { expect, test } from "bun:test";
import {
  entryOptions,
  reclaimableBytes,
  scriptOptions,
  selectSuite,
  smokeList,
  suiteArgs,
  testOptions,
  workerCount,
  workerCountFor,
} from "../../../src/testing/test.ts";
import { standardScript } from "../../../src/core/test-script.ts";
import { scriptViolations } from "../../../src/testing/test-layout.ts";
import { smokeFiles } from "../../../src/testing/test-skips.ts";

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

test("--full selects the full suite", () => {
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
  expect(scriptViolations({ scripts: { test: "checks-test --changed", "test:fast": "checks-test --changed", lint: "checks-lint" } }).map((violation) => violation.message)).toEqual([
    'scripts.test must be "checks-test", which runs the default suite and judges its skips, found "checks-test --changed"',
  ]);
});

test("the standard scripts are test, test:fast and one tier script per tier, with nothing else", () => {
  expect(standardScript("checks-test")).toEqual({ kind: "test" });
  expect(standardScript("bun src/testing/test.ts")).toBeUndefined();
  expect(standardScript("bun src/testing/test.ts --changed")).toBeUndefined();
  expect(standardScript("checks-test --changed")).toEqual({ kind: "fast" });
  expect(standardScript("checks-test --tier=unit")).toEqual({ kind: "tier", tier: "unit" });
  expect(standardScript("checks-test --tier=e2e")).toEqual({ kind: "tier", tier: "e2e" });
  expect(standardScript("checks-test --tier=live")).toEqual({ kind: "tier", tier: "live" });
  expect(standardScript("checks-test --tier=pixel")).toEqual({ kind: "tier", tier: "pixel" });
});

test("a standard script never carries a worker count, so no repository pins its own parallelism", () => {
  expect(standardScript("checks-test --parallel=4")).toBeUndefined();
  expect(standardScript("checks-test --tier=live --parallel=4")).toBeUndefined();
  expect(standardScript("checks-test --parallel=4 --tier=live")).toBeUndefined();
});

test("a standard script never forces the full suite, keeps the junit report or takes a filter", () => {
  expect(standardScript("checks-test --full")).toBeUndefined();
  expect(standardScript("checks-test --junit=reports/suite.xml")).toBeUndefined();
  expect(standardScript("checks-test tests/unit")).toBeUndefined();
  expect(standardScript("checks-test --changed --tier=unit")).toBeUndefined();
  expect(standardScript("bun test")).toBeUndefined();
});

test("workerCountFor leaves a gigabyte for the first worker, a hundred megabytes per extra worker and a tenth in reserve", () => {
  expect(workerCountFor(8 * 1024 ** 3, 16 * 1024 ** 3, 8)).toBe(8);
  expect(workerCountFor(2 * 1024 ** 3, 8 * 1024 ** 3, 8)).toBe(2);
  expect(workerCountFor(64 * 1024 ** 3, 64 * 1024 ** 3, 4)).toBe(4);
});

test("workerCountFor never drops below one worker on an exhausted machine", () => {
  expect(workerCountFor(0, 8 * 1024 ** 3, 8)).toBe(1);
});

test("an explicit worker count still overrides the memory count for one run", () => {
  expect(workerCount(3)).toBe(3);
  expect(workerCount(undefined)).toBeGreaterThanOrEqual(1);
});

test("reclaimableBytes counts the free, inactive and speculative pages at the vm_stat page size", () => {
  const vmStat = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free: 100.",
    "Pages active: 1000.",
    "Pages inactive: 200.",
    "Pages speculative: 300.",
    "",
  ].join("\n");
  expect(reclaimableBytes(vmStat)).toBe(600 * 16384);
});

test("reclaimableBytes refuses a vm_stat report that names no page size or page class", () => {
  expect(reclaimableBytes("Pages free: 100.\n")).toBeUndefined();
  expect(reclaimableBytes("Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\n")).toBeUndefined();
});

test("a --changed run passes only the files it reached to bun test, rather than the whole unit level", () => {
  expect(suiteArgs({ kind: "changed", files: ["tests/unit/docs.test.ts", "tests/e2e/docs.test.ts"] }, ["tests/e2e/smoke.test.ts"])).toEqual([
    "./tests/unit/docs.test.ts",
    "./tests/e2e/docs.test.ts",
  ]);
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

test("scripts.test never forces the full suite, so a local run stays on the smoke run", () => {
  expect(scriptOptions("checks-test --full")).toEqual({ full: true });
  expect(
    scriptViolations({ scripts: { test: "checks-test --full", "test:fast": "checks-test --changed", lint: "checks-lint" } }),
  ).toHaveLength(1);
  expect(
    scriptViolations({ scripts: { test: "checks-test", "test:fast": "checks-test --changed", lint: "checks-lint" } }),
  ).toBeEmpty();
});
