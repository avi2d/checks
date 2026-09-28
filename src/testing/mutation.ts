#!/usr/bin/env bun
import { Config, Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { runMain } from "../core/main.ts";
import { fullRunRefusal } from "./mutation-scope.js";

export class MutationError extends Schema.TaggedError<MutationError>()("MutationError", {
  message: Schema.String,
}) {}

const readCi = Config.String("CI").pipe(
  Config.withDefault(""),
  Effect.mapError((cause) => new MutationError({ message: `cannot read CI: ${cause.message}` })),
);

const runStryker = Effect.fn("runStryker")(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(process.execPath, ["x", "stryker", "run", ...args], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  return exitCode === ChildProcessSpawner.ExitCode(0);
});

const mutation = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const refusal = fullRunRefusal(args, yield* readCi);
  if (refusal !== undefined) return yield* new MutationError({ message: refusal });
  return yield* runStryker(args);
});

if (import.meta.main) runMain("checks-mutation", mutation);
