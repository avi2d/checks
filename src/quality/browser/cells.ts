import { Config, Effect, Option, Schema } from "effect";
import { BrowserFailure } from "./page.ts";

export type Cell<A, E> = {
  readonly reading: Effect.Effect<A, E>;
  readonly alone: boolean;
};

const CELLS_VARIABLE = "CHECKS_BROWSER_CELLS";

export const cellsAtOnce = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), CELLS_VARIABLE).pipe(
  Config.withDefault(4),
  Effect.mapError(() => new BrowserFailure({ message: `${CELLS_VARIABLE} caps the cells run at once, so set it to a whole number from 1` })),
);

// The results keep the order the cells are listed in, whichever finishes first.
export const walkCells = Effect.fn("walkCells")(function* <A, E>(cells: readonly Cell<A, E>[], concurrency: number) {
  const together = yield* Effect.forEach(cells, ({ reading, alone }) => (alone ? Effect.succeedNone : Effect.asSome(reading)), { concurrency });
  return yield* Effect.forEach(cells, ({ reading }, index) => Option.match(together[index] ?? Option.none(), { onNone: () => reading, onSome: Effect.succeed }));
});
