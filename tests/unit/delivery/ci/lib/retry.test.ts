import { describe, expect, test } from "bun:test";
import { Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { parseAttempts, retryWithGrowingWait } from "../../../../../src/delivery/ci/lib/retry.ts";
import { withClock } from "../../../../lib/clock.ts";

function countedTries(passFrom: number) {
  let tries = 0;
  const tryOnce = Effect.sync(() => {
    tries += 1;
    return tries >= passFrom;
  });
  return { tryOnce, tries: () => tries };
}

describe("retryWithGrowingWait", () => {
  test("a try that keeps failing tried other than 3 times, or reported passed, fails", async () => {
    const counted = countedTries(Infinity);
    const passed = await withClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(retryWithGrowingWait(counted.tryOnce, { attempts: 3, wait: Duration.seconds(10), onRetry: () => Effect.void }));
        yield* TestClock.adjust("1 minute");
        return yield* Fiber.join(fiber);
      }),
    );
    expect([counted.tries(), passed]).toEqual([3, false]);
  });

  test("a third try before 10 and then 20 seconds pass fails", async () => {
    const counted = countedTries(Infinity);
    const seen = await withClock(
      Effect.gen(function* () {
        yield* Effect.forkChild(retryWithGrowingWait(counted.tryOnce, { attempts: 3, wait: Duration.seconds(10), onRetry: () => Effect.void }));
        yield* TestClock.adjust("9999 millis");
        const beforeFirstWait = counted.tries();
        yield* TestClock.adjust("1 millis");
        yield* TestClock.adjust("19999 millis");
        const beforeSecondWait = counted.tries();
        yield* TestClock.adjust("1 millis");
        return [beforeFirstWait, beforeSecondWait, counted.tries()];
      }),
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  test("a try after one passes, or a retry note for the try that passed, fails", async () => {
    const counted = countedTries(2);
    const notes: number[] = [];
    const passed = await withClock(
      Effect.gen(function* () {
        const onRetry = (failed: number) => Effect.sync(() => void notes.push(failed));
        const fiber = yield* Effect.forkChild(retryWithGrowingWait(counted.tryOnce, { attempts: 3, wait: Duration.seconds(10), onRetry }));
        yield* TestClock.adjust("1 minute");
        return yield* Fiber.join(fiber);
      }),
    );
    expect([counted.tries(), passed, notes]).toEqual([2, true, [1]]);
  });
});

describe("parseAttempts", () => {
  test.each(["", "0", "-1", "1.5", "two", " 2"])("attempts of %p that passes fails", (text) => {
    expect(Exit.isFailure(Effect.runSyncExit(parseAttempts(text)))).toBe(true);
  });

  test.each([["1", 1], ["3", 3]] as const)("attempts of %p read as other than %p fails", (text, attempts) => {
    expect(Effect.runSync(parseAttempts(text))).toBe(attempts);
  });
});
