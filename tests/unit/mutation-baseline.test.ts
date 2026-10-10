import { expect, test } from "bun:test";
import { newestFirst, pruned } from "../../src/testing/mutation-baseline.ts";

// GitHub numbers artifacts in the order it creates them, so a higher id is a newer artifact.
test("pruning keeps the highest artifact ids and the one being restored, and passes over a name that is no id", () => {
  expect(pruned(["9", "100", ".staging-ab12", "11", "2"], 2, "100")).toEqual(["9", "2"]);
  expect(pruned(["9", "100", ".staging-ab12", "11", "2"], 2, "2")).toEqual(["9"]);
  expect(pruned(["5"], 2, "5")).toEqual([]);
});

test("full candidates from two event lists merge newest first by creation time", () => {
  const runs = [
    { databaseId: 1, event: "schedule", createdAt: "2026-10-01T00:00:00Z" },
    { databaseId: 3, event: "schedule", createdAt: "2026-10-08T00:00:00Z" },
    { databaseId: 2, event: "workflow_dispatch", createdAt: "2026-10-04T12:30:00Z" },
  ];
  expect(newestFirst(runs)).toEqual([3, 2, 1]);
});
