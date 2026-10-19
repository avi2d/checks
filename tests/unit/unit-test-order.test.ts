import { expect, test } from "bun:test";
import { fastestFirst, inRunOrder, ordersTests } from "../../src/testing/unit-test-order.ts";

test("files run fastest first, and files that take the same time run in path order", () => {
  const seconds = new Map([
    ["tests/unit/slow.test.ts", 6.6],
    ["tests/unit/b.test.ts", 0.03],
    ["tests/unit/a.test.ts", 0.03],
  ]);
  expect(fastestFirst(seconds)).toEqual(["tests/unit/a.test.ts", "tests/unit/b.test.ts", "tests/unit/slow.test.ts"]);
});

test("the run order spells each file with ./ in timed order, then lists every bare path the runner narrows to", () => {
  const listed = ["tests/unit/a.test.ts", "tests/unit/b.test.ts", "tests/unit/new.test.ts"];
  const timed = ["tests/unit/b.test.ts", "tests/unit/gone.test.ts", "tests/unit/a.test.ts"];
  expect(inRunOrder(listed, timed)).toEqual([
    "./tests/unit/b.test.ts",
    "./tests/unit/a.test.ts",
    "./tests/unit/new.test.ts",
    "tests/unit/a.test.ts",
    "tests/unit/b.test.ts",
    "tests/unit/new.test.ts",
  ]);
});

test("only a Stryker run that can test a static mutant times the unit tests", () => {
  expect(ordersTests("run", ["--incremental"])).toBe(true);
  expect(ordersTests("run", ["--mutate", "src/billing.ts"])).toBe(true);
  expect(ordersTests("run", ["--incremental", "--ignoreStatic", "--mutate", "src/billing.ts"])).toBe(false);
  expect(ordersTests("run", ["--help"])).toBe(false);
  expect(ordersTests("init", [])).toBe(false);
  expect(ordersTests(undefined, [])).toBe(false);
});
