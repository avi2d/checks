import { expect, test } from "bun:test";
import { violationsOf } from "../../../src/delivery/no-mistakes-test.ts";

test("an absent commands.test passes, since no repository test runs", () => {
  expect(violationsOf({})).toEqual([]);
  expect(violationsOf({ commands: {} })).toEqual([]);
  expect(violationsOf({ commands: { prepare: "bun install" } })).toEqual([]);
});

test("a changed-only test command fails instead of running tests on the pipeline machine", () => {
  const violations = violationsOf({ commands: { test: "bunx checks-test --changed --parallel=3" } });
  expect(violations).toHaveLength(1);
  expect(violations[0]?.message).toContain('found "bunx checks-test --changed --parallel=3"');
});

test("a bun run script fails instead of passing because its target runs only changed tests", () => {
  expect(violationsOf({ commands: { test: "bun run test:fast" } })).toHaveLength(1);
});

test("a whole-suite command fails instead of running every test on the pipeline machine", () => {
  expect(violationsOf({ commands: { test: "bun run test" } })).toHaveLength(1);
});

test("an empty or null commands.test fails instead of passing as absent", () => {
  expect(violationsOf({ commands: { test: "" } })).toHaveLength(1);
  expect(violationsOf({ commands: { test: null } })[0]?.message).toContain("found null");
});
