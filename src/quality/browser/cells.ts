import { Effect, Option } from "effect";

export type Cell<A, E> = {
  readonly reading: Effect.Effect<A, E>;
  readonly alone: boolean;
};

// The results keep the order the cells are listed in, whichever finishes first.
export const walkCells = Effect.fn("walkCells")(function* <A, E>(cells: readonly Cell<A, E>[], concurrency: number) {
  const together = yield* Effect.forEach(cells, ({ reading, alone }) => (alone ? Effect.succeedNone : Effect.asSome(reading)), { concurrency });
  return yield* Effect.forEach(cells, ({ reading }, index) => Option.match(together[index] ?? Option.none(), { onNone: () => reading, onSome: Effect.succeed }));
});
