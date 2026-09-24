import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Cause, Console, Effect, Exit, Schema } from "effect";

const PASSED = 0;
const VIOLATED = 1;
const UNDECIDED = 2;
const INTERRUPTED = 130;

export class Usage extends Schema.TaggedError<Usage>()("Usage", {
  message: Schema.String,
}) {}

function statusOf<A, E>(exit: Exit.Exit<A, E>): number {
  if (Exit.isSuccess(exit)) return typeof exit.value === "number" ? exit.value : UNDECIDED;
  return Cause.hasInterruptsOnly(exit.cause) ? INTERRUPTED : UNDECIDED;
}

export function runMain<E extends { readonly message: string }>(
  name: string,
  passes: Effect.Effect<boolean, E, BunServices.BunServices>,
): void {
  const program = passes.pipe(
    Effect.map((passed) => (passed ? PASSED : VIOLATED)),
    Effect.catch((failure) => Console.error(`${name}: ${failure.message}`).pipe(Effect.as(UNDECIDED))),
    Effect.provide(BunServices.layer),
  );
  BunRuntime.runMain(program, { teardown: (exit, onExit) => onExit(statusOf(exit)) });
}
