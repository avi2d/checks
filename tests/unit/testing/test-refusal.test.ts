import { expect, test } from "bun:test";
import { heavyRunRefusal } from "../../../src/testing/test-refusal.ts";

test("a --full or e2e run outside CI is refused rather than run, and names the pull request", () => {
  expect(heavyRunRefusal({ full: true }, "local", false)).toBe("refusing a `--full` run outside CI; push the branch and open or update its pull request so CI runs the checks, and the full suite runs at release");
  expect(heavyRunRefusal({ tier: "e2e", workers: 4 }, "local", false)).toBe(
    "refusing a `--tier=e2e` run outside CI; push the branch and open or update its pull request so CI runs the checks, and the full suite runs at release",
  );
});

test("a pixel run without approve outside CI refuses, and names the whole-tree-run workflow and the approve exception", () => {
  expect(heavyRunRefusal({ tier: "pixel" }, "local", false)).toBe(
    "refusing a `--tier=pixel` run outside CI; push the branch, then start the same run in CI with `gh workflow run whole-tree-run --ref <branch>`, or approve pictures here with `APPROVE_SCREENS=1`",
  );
});

test("a pixel run that approves pictures outside CI is not refused, since CI cannot write the pictures back", () => {
  expect(heavyRunRefusal({ tier: "pixel" }, "local", true)).toBeUndefined();
});

test("approving pictures does not unlock a --full or e2e run outside CI", () => {
  expect(heavyRunRefusal({ full: true }, "local", true)).toBeDefined();
  expect(heavyRunRefusal({ tier: "e2e" }, "local", true)).toBeDefined();
});

test("the live, unit, default and changed runs are not refused outside CI", () => {
  expect(heavyRunRefusal({ tier: "live" }, "local", false)).toBeUndefined();
  expect(heavyRunRefusal({ tier: "unit" }, "local", false)).toBeUndefined();
  expect(heavyRunRefusal({}, "local", false)).toBeUndefined();
  expect(heavyRunRefusal({ workers: 2 }, "local", false)).toBeUndefined();
});

test("no run is refused under CI", () => {
  expect(heavyRunRefusal({ full: true }, "ci", false)).toBeUndefined();
  expect(heavyRunRefusal({ tier: "e2e" }, "ci", false)).toBeUndefined();
  expect(heavyRunRefusal({ tier: "pixel" }, "ci", false)).toBeUndefined();
});
