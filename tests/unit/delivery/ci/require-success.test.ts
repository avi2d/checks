import { expect, test } from "bun:test";
import { passes } from "../../../../src/delivery/ci/require-success.ts";

const SKIPS = new Set(["site=true"]);

test("a successful part that the gate fails fails", () => {
  expect(passes("unit=success", SKIPS)).toBe(true);
});

test("a part skipped where skips names it that the gate fails fails", () => {
  expect(passes("site=skipped", SKIPS)).toBe(true);
});

test.each(["unit=skipped", "unit=failure", "unit=cancelled", "site=failure"])("a part of %p that the gate passes fails", (pair) => {
  expect(passes(pair, SKIPS)).toBe(false);
});
