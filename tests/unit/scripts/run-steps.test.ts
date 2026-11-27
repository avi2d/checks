import { expect, test } from "bun:test";
import { withForwarded } from "../../../scripts/run-steps.ts";

test("forwarded arguments that land on every step or on the first step instead of the last fail", () => {
  expect(withForwarded([["a", "1"], ["b"], ["c", "2"]], ["--x", "y"])).toEqual([["a", "1"], ["b"], ["c", "2", "--x", "y"]]);
});

test("no forwarded arguments that still change a step fail", () => {
  const steps = [["a"], ["b", "1"]] as const;
  expect(withForwarded(steps, [])).toEqual([["a"], ["b", "1"]]);
});
