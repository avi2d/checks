import { expect, test } from "bun:test";
import { isHelp, isScoped, refusal, shouldRefuse } from "../../src/testing/mutation.ts";

test("a full run outside CI is refused and names the CI command", () => {
  expect(shouldRefuse([], false)).toBe(true);
  expect(refusal()).toContain("gh workflow run mutation");
});

test("a run scoped to named files stays allowed locally", () => {
  expect(isScoped(["--mutate", "src/billing.ts"])).toBe(true);
  expect(isScoped(["--mutate=src/billing.ts"])).toBe(true);
  expect(shouldRefuse(["--mutate", "src/billing.ts"], false)).toBe(false);
});

test("an incremental run stays allowed locally", () => {
  expect(isScoped(["--incremental"])).toBe(true);
  expect(isScoped(["--incrementalFile", "reports/mutation/incremental.json"])).toBe(true);
  expect(shouldRefuse(["--incremental"], false)).toBe(false);
});

test("every run stays allowed in CI", () => {
  expect(shouldRefuse([], true)).toBe(false);
  expect(shouldRefuse(["--mutate", "src/billing.ts"], true)).toBe(false);
});

test("help never refuses", () => {
  expect(isHelp(["--help"])).toBe(true);
  expect(isHelp(["-h"])).toBe(true);
  expect(shouldRefuse(["--help"], false)).toBe(false);
});
