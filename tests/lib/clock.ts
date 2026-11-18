import { Effect } from "effect";
import { TestClock } from "effect/testing";

export function withClock<A>(program: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
}

export type CountedReads<A> = { readonly read: Effect.Effect<A>; readonly reads: () => number };

export function countedReads<A>(valueAt: (read: number) => A): CountedReads<A> {
  let reads = 0;
  const read = Effect.sync(() => {
    reads += 1;
    return valueAt(reads);
  });
  return { read, reads: () => reads };
}
