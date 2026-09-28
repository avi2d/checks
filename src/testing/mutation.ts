#!/usr/bin/env bun
import { Config, Console, Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { runMain } from "../core/main.ts";

export class MutationError extends Schema.TaggedError<MutationError>()("MutationError", {
  message: Schema.String,
}) {}

const NAME = "checks-mutation";
const WORKFLOW_COMMAND = "gh workflow run mutation";
const USAGE = `usage: ${NAME} [--help] [--mutate <glob>...] [--incremental] [<stryker args>...]`;

export function isHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function isScoped(args: readonly string[]): boolean {
  return args.some(
    (arg) => arg === "--mutate" || arg.startsWith("--mutate=") || arg === "--incremental" || arg.startsWith("--incremental"),
  );
}

export function shouldRefuse(args: readonly string[], ci: boolean): boolean {
  return !ci && !isHelp(args) && !isScoped(args);
}

export function refusal(): string {
  return `refusing a full mutation run outside CI; start the same run in CI with \`${WORKFLOW_COMMAND}\`, or scope this run with \`--mutate\` or \`--incremental\``;
}

const readCi = Config.Boolean("CI").pipe(
  Config.withDefault(false),
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
  if (isHelp(args)) {
    yield* Console.log(
      [USAGE, `A full run outside CI is refused; ${WORKFLOW_COMMAND} starts it in CI.`, "A run with --mutate or --incremental stays allowed locally."].join(
        "\n",
      ),
    );
    return true;
  }
  if (shouldRefuse(args, yield* readCi)) return yield* new MutationError({ message: refusal() });
  return yield* runStryker(args);
});

if (import.meta.main) runMain(NAME, mutation);
