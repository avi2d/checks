import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Cause, Effect, Layer } from "effect";

export const platform = BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, BunPath.layer)));

export type Platform = Layer.Success<typeof platform>;

// runMain reports through the logger to stdout, where a script's output is its answer.
const reported = <A, E>(program: Effect.Effect<A, E, Platform>): Effect.Effect<A, E, Platform> =>
  Effect.tapCause(program, (cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))));

export const main = <A, E>(program: Effect.Effect<A, E, Platform>): void =>
  program.pipe(reported, Effect.provide(platform), BunRuntime.runMain({ disableErrorReporting: true }));
