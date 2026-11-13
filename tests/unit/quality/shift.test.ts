import { expect, test } from "bun:test";
import { formatShift, judgeShift } from "../../../src/quality/browser/shift.ts";

test("a still cold load passes", () => {
  expect(judgeShift({ max: 0.1 }, 0)).toEqual([]);
});

test("a cold load at exactly its bound passes, not over it", () => {
  expect(judgeShift({ max: 0.1 }, 0.1)).toEqual([]);
});

test("a cold load past its bound fails naming the total, not silently", () => {
  expect(formatShift(0.15000000002)).toBe("0.150");
  expect(judgeShift({ max: 0.1 }, 0.15000000002)).toEqual(["the cold load shifts 0.150, over the 0.1 bound"]);
});
