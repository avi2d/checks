import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { heldOn, sweep, type Run } from "../../../../src/delivery/ci/held-runs.ts";
import { countedReads, withClock } from "../../../lib/clock.ts";

const TIP = "0123456789abcdef0123456789abcdef01234567";
const HEAD = { repository: "owner/site", branch: "release/main", sha: TIP };

const held = (id: number, change: Partial<Run> = {}): Run => ({
  id,
  name: "ci",
  event: "pull_request",
  conclusion: "action_required",
  head_sha: TIP,
  head_branch: "release/main",
  head_repository: { full_name: "owner/site" },
  ...change,
});

describe("heldOn", () => {
  test("held-runs that leaves the release head's held run fails", () => {
    expect(heldOn([held(1)], HEAD).map(({ id }) => id)).toEqual([1]);
  });

  test("held-runs that deletes a fork's held run fails", () => {
    expect(heldOn([held(2, { head_repository: { full_name: "stranger/site" } }), held(3, { head_repository: null })], HEAD)).toEqual([]);
  });

  test("held-runs that deletes a run that has jobs fails", () => {
    expect(heldOn([held(4, { conclusion: "success" }), held(5, { conclusion: null })], HEAD)).toEqual([]);
  });

  test("held-runs that deletes a held run on another head fails", () => {
    const elsewhere = [held(6, { head_sha: "f".repeat(40) }), held(7, { head_branch: "feature" }), held(8, { event: "pull_request_target" })];
    expect(heldOn(elsewhere, HEAD)).toEqual([]);
  });
});

async function sweepOver(foundAt: (read: number) => number) {
  const counted = countedReads(foundAt);
  const deleted = await withClock(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(sweep(counted.read, 30));
      yield* TestClock.adjust("1 minute");
      return yield* Fiber.join(fiber);
    }),
  );
  return [deleted, counted.reads()];
}

describe("sweep", () => {
  test("held-runs that fails when nothing is held, or stops reading before 30 seconds pass, fails", async () => {
    expect(await sweepOver(() => 0)).toEqual([0, 7]);
  });

  test("held-runs that stops before the read after a delete, or reads on past an empty one, fails", async () => {
    expect(await sweepOver((read) => (read === 2 ? 2 : read === 4 ? 1 : 0))).toEqual([2, 3]);
  });
});
