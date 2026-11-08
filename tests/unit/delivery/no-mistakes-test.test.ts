import { expect, test } from "bun:test";
import { isTouchedOnly, violationsOf } from "../../../src/delivery/no-mistakes-test.ts";

const FAST = { scripts: { test: "bun src/testing/test.ts", "test:fast": "bun src/testing/test.ts --changed" } };

test("an absent commands.test passes, since no suite runs", () => {
  expect(violationsOf({}, FAST)).toEqual([]);
  expect(violationsOf({ commands: {} }, FAST)).toEqual([]);
  expect(violationsOf({ commands: { prepare: "bun install" } }, FAST)).toEqual([]);
});

test("checks-test --changed passes as the touched-only command", () => {
  expect(violationsOf({ commands: { test: "checks-test --changed" } }, {})).toEqual([]);
  expect(isTouchedOnly("bun src/testing/test.ts --changed", {})).toBe(true);
});

test("a bun run script that runs checks-test --changed passes, like this repository's test:fast", () => {
  expect(violationsOf({ commands: { test: "bun run test:fast" } }, FAST)).toEqual([]);
});

test("bun run test fails instead of running the whole suite", () => {
  const violations = violationsOf({ commands: { test: "bun run test" } }, FAST);
  expect(violations).toHaveLength(1);
  expect(violations[0]?.message).toContain('found "bun run test"');
});

test("a bare checks-test fails instead of running the whole suite", () => {
  const violations = violationsOf({ commands: { test: "checks-test" } }, {});
  expect(violations).toHaveLength(1);
  expect(violations[0]?.message).toContain('found "checks-test"');
});

test("a direct suite path without --changed fails instead of running the whole suite", () => {
  expect(violationsOf({ commands: { test: "bun src/testing/test.ts" } }, {})).toHaveLength(1);
});

test("a chained command fails instead of hiding a suite run after &&", () => {
  expect(violationsOf({ commands: { test: "checks-test --changed && bun run test" } }, FAST)).toHaveLength(1);
});

test("an unknown bun run script fails instead of passing a command nothing defines", () => {
  expect(violationsOf({ commands: { test: "bun run test:quick" } }, FAST)).toHaveLength(1);
});

test("a cyclic script chain fails instead of resolving forever", () => {
  const manifest = { scripts: { a: "bun run b", b: "bun run a" } };
  expect(violationsOf({ commands: { test: "bun run a" } }, manifest)).toHaveLength(1);
});

test("a changed run narrowed by a tier fails instead of passing a refused combination", () => {
  expect(violationsOf({ commands: { test: "checks-test --changed --tier=unit" } }, {})).toHaveLength(1);
});
