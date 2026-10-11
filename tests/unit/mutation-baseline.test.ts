import { expect, test } from "bun:test";
import { newestFirst, pruneReport, pruned, superseded } from "../../src/testing/mutation-baseline.ts";

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

function artifact(id: number, name: string, expired = false) {
  return { id, name, expired, workflow_run: { repository_id: 4242 } };
}

test("superseded keeps the newest of each baseline name, expired artifacts and other names", () => {
  const artifacts = [
    artifact(300, "mutation-baseline"),
    artifact(200, "mutation-baseline"),
    artifact(350, "mutation-baseline-full"),
    artifact(100, "mutation-baseline", true),
    artifact(999, "other"),
  ];
  expect(superseded(artifacts, new Set([200, 350]))).toEqual([artifact(300, "mutation-baseline")]);
  expect(superseded(artifacts, new Set([200, 300, 350]))).toEqual([]);
});

test("pruneReport names the deleted, the missed and the kept artifacts", () => {
  const keeping = [
    { run: 20, id: 200, name: "mutation-baseline" },
    { run: 35, id: 350, name: "mutation-baseline-full" },
  ];
  expect(pruneReport(false, [100, 250, 300], [], keeping)).toBe(
    "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  expect(pruneReport(false, [100], [250], keeping)).toBe(
    "mutation-baseline: deleted artifacts 100; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35; could not delete artifacts 250",
  );
  expect(pruneReport(false, [], [], keeping)).toBe(
    "mutation-baseline: nothing to delete; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  expect(pruneReport(true, [100, 250, 300], [], keeping)).toBe(
    "mutation-baseline: dry run, would delete artifacts 100, 250, 300; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  expect(pruneReport(true, [], [], [])).toBe("mutation-baseline: dry run, nothing to delete; would keep no baseline artifacts");
});
