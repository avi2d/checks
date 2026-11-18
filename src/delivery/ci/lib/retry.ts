import { Data, Duration, Effect } from "effect";

export class AttemptsInvalid extends Data.TaggedError("AttemptsInvalid")<{ readonly message: string }> {}

export function parseAttempts(text: string): Effect.Effect<number, AttemptsInvalid> {
  const attempts = Number(text);
  return /^[0-9]+$/.test(text) && attempts >= 1
    ? Effect.succeed(attempts)
    : Effect.fail(new AttemptsInvalid({ message: `attempts must be a whole number from 1, not '${text}'` }));
}

export type Tries = {
  readonly attempts: number;
  readonly wait: Duration.Duration;
  readonly onRetry: (failedAttempt: number) => Effect.Effect<void>;
};

// The wait after the nth failed try is n times the wait.
export const retryWithGrowingWait = <E, R>(tryOnce: Effect.Effect<boolean, E, R>, { attempts, wait, onRetry }: Tries): Effect.Effect<boolean, E, R> =>
  Effect.gen(function* () {
    for (let attempt = 1; ; attempt += 1) {
      if (yield* tryOnce) return true;
      if (attempt >= attempts) return false;
      yield* onRetry(attempt);
      yield* Effect.sleep(Duration.times(wait, attempt));
    }
  });
