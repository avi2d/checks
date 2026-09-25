import { expect, test } from "bun:test";
import { repeatedLines } from "../scripts/repetition.ts";

test("a file's repeated lines are the union of its fragments, so overlapping clones count a line once", () => {
  const counted = repeatedLines([
    [
      { file: "src/a.ts", start: 1, end: 10 },
      { file: "src/b.ts", start: 21, end: 30 },
    ],
    [
      { file: "src/a.ts", start: 6, end: 15 },
      { file: "src/c.ts", start: 1, end: 10 },
    ],
    [
      { file: "src/c.ts", start: 20, end: 24 },
      { file: "src/c.ts", start: 30, end: 34 },
    ],
  ]);
  expect(Object.fromEntries(counted)).toEqual({ "src/a.ts": 15, "src/b.ts": 10, "src/c.ts": 20 });
});
