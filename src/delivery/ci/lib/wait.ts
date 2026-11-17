import { Effect, type Duration } from "effect";

export const readUntil = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean, tries: number, wait: Duration.Duration): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    for (let attempt = 1; ; attempt += 1) {
      const value = yield* read;
      if (done(value) || attempt >= tries) return value;
      yield* Effect.sleep(wait);
    }
  });
