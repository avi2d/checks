import { Effect } from "effect";
import { platform, type Platform } from "../core/bun-platform.ts";

export const run = <A, E>(effect: Effect.Effect<A, E, Platform>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(platform)));
