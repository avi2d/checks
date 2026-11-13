import { expect, test } from "bun:test";
import { judgePageWeight } from "../../../src/quality/browser/weight.ts";

const BUDGETS = { nonImageBytes: 1_000, scriptBytes: 500, imageBytes: 2_000 };

test("a page inside every budget passes", () => {
  expect(judgePageWeight(BUDGETS, { nonImage: 900, script: 400, image: 1_900, responses: 4 })).toEqual([]);
});

test("a page at exactly its budgets passes, not over them", () => {
  expect(judgePageWeight(BUDGETS, { nonImage: 1_000, script: 500, image: 2_000, responses: 4 })).toEqual([]);
});

test("a page over a budget fails naming the overage, not silently", () => {
  expect(judgePageWeight(BUDGETS, { nonImage: 1_200, script: 400, image: 1_900, responses: 4 })).toEqual([
    "1200 bytes besides images over 1000 (over by 200)",
  ]);
  expect(judgePageWeight(BUDGETS, { nonImage: 900, script: 700, image: 1_900, responses: 4 })).toEqual([
    "700 bytes of scripts over 500 (over by 200)",
  ]);
  expect(judgePageWeight(BUDGETS, { nonImage: 900, script: 400, image: 2_400, responses: 4 })).toEqual([
    "2400 bytes of images over 2000 (over by 400)",
  ]);
});

test("script bytes count against the script budget as well as the non-image one, not only once", () => {
  expect(judgePageWeight(BUDGETS, { nonImage: 600, script: 600, image: 100, responses: 2 })).toEqual([
    "600 bytes of scripts over 500 (over by 100)",
  ]);
});

test("an empty weighing fails instead of passing every budget", () => {
  expect(judgePageWeight(BUDGETS, { nonImage: 0, script: 0, image: 0, responses: 0 })).toEqual([
    "weighed no response the page serves from its own origin",
  ]);
});
