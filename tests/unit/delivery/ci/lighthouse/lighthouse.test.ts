import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { parseRuns } from "../../../../../src/delivery/ci/lighthouse/lighthouse.ts";

test("a whole number of runs from 1 that is refused fails", () => {
  expect(Effect.runSync(parseRuns("3"))).toBe(3);
  expect(Effect.runSync(parseRuns("12"))).toBe(12);
});

test.each(["0", "", "-1", "2.5", "three", "03", " 3"])("runs of %p, which is no whole number from 1, that pass fail", (text) => {
  expect(Exit.isFailure(Effect.runSyncExit(parseRuns(text)))).toBe(true);
});
