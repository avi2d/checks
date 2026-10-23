import { expect, test } from "bun:test";
import { baseline, fullReport, run, savedEntry, selfHosted } from "./lib/baseline-runner.ts";

// The restore takes run 20's baseline and run 35's full report, so the prune keeps artifacts 200 and 350.
const PRUNE_RUNS = [
  run(35, "workflow_dispatch", "2026-10-04T00:00:00Z", [fullReport(350, "newest full")]),
  run(30, "pull_request", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline", "pull request")]),
  run(25, "schedule", "2026-10-02T12:00:00Z", [fullReport(250, "older full")]),
  run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  run(10, "push", "2026-10-01T00:00:00Z", [baseline(100, "mutation-baseline", "older push"), { id: 999, name: "other", expired: false, files: {} }]),
];

function deleted(calls: readonly string[]): readonly number[] {
  return calls
    .flatMap((call) => {
      const matched = /artifacts\/(\d+)$/.exec(call);
      return matched === null ? [] : [Number(matched[1])];
    })
    .sort((one, other) => one - other);
}

test("--prune deletes every superseded baseline but the newest of each, and never another name", async () => {
  const runner = await selfHosted(PRUNE_RUNS);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 250, 300]);
  const again = await runner.run(["--prune", "--dry-run"]);
  expect(again.text).toBe("mutation-baseline: dry run, nothing to delete; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n");
}, 30_000);

test("--prune --dry-run lists what would go and deletes nothing", async () => {
  const runner = await selfHosted(PRUNE_RUNS);

  const dried = await runner.run(["--prune", "--dry-run"]);

  expect(dried).toEqual({
    exitCode: 0,
    text: "mutation-baseline: dry run, would delete artifacts 100, 250, 300; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune keeps the uploads of the run it runs in, which the restore takes once that run succeeds", async () => {
  const runner = await selfHosted(
    [run(40, "schedule", "2026-10-05T00:00:00Z", [baseline(400, "mutation-baseline", "this run"), fullReport(450, "this run's full")]), ...PRUNE_RUNS],
    { inProgress: [40] },
  );

  const pruned = await runner.run(["--prune"], { GITHUB_RUN_ID: "40" });

  expect(pruned).toEqual({
    exitCode: 0,
    text:
      "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35, " +
      "mutation-baseline artifact 400 from run 40, mutation-baseline-full artifact 450 from run 40\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 250, 300]);
}, 30_000);

test("--prune on a repository's first run keeps both of that run's uploads", async () => {
  const runner = await selfHosted([run(40, "workflow_dispatch", "2026-10-05T00:00:00Z", [baseline(400, "mutation-baseline", "first"), fullReport(450, "first full")])], {
    inProgress: [40],
  });

  const pruned = await runner.run(["--prune"], { GITHUB_RUN_ID: "40" });

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: nothing to delete; kept mutation-baseline artifact 400 from run 40, mutation-baseline-full artifact 450 from run 40\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune deletes nothing and exits 2 when a run's artifact lookup fails", async () => {
  const runner = await selfHosted(PRUNE_RUNS, { failing: ["api repos/{owner}/{repo}/actions/runs/20/artifacts"] });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 2,
    text: "checks-mutation-baseline: gh api repos/{owner}/{repo}/actions/runs/20/artifacts?name=mutation-baseline: gh: HTTP 502\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune warns of each artifact it could not delete, deletes the rest and exits 0", async () => {
  const runner = await selfHosted(PRUNE_RUNS, { failing: ["api -X DELETE repos/{owner}/{repo}/actions/artifacts/250"] });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text:
      "::warning::mutation-baseline: could not delete mutation-baseline-full artifact 250: gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/250: gh: HTTP 502\n" +
      "mutation-baseline: deleted artifacts 100, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35; could not delete artifacts 250\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 300]);
}, 30_000);

test("--prune with nothing superseded deletes nothing", async () => {
  const runner = await selfHosted([
    run(35, "workflow_dispatch", "2026-10-04T00:00:00Z", [fullReport(350, "newest full")]),
    run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  ]);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: nothing to delete; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune with no baselines at all deletes nothing", async () => {
  const runner = await selfHosted([run(20, "push", "2026-10-02T00:00:00Z", [])]);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({ exitCode: 0, text: "mutation-baseline: nothing to delete; kept no baseline artifacts\n" });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune deletes the artifact of an older run once the newest successful run's baseline is on the disk", async () => {
  const runner = await selfHosted([run(40, "push", "2026-10-05T00:00:00Z", []), ...PRUNE_RUNS]);
  await savedEntry(runner, 40, { "stryker-incremental.json": { run: 40 } });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: deleted artifacts 100, 200, 250, 300; kept mutation-baseline-full artifact 350 from run 35, the mutation-baseline run 40 saved on the runner's disk\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 200, 250, 300]);
}, 30_000);
