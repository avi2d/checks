import { Console, Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { runExitMain } from "../src/core/main.ts";

export type Step = readonly [program: string, ...args: readonly string[]];

const PASSED = 0;
const NOT_FOUND = 127;

export const bunStep = (...args: readonly string[]): Step => [process.execPath, ...args];

// bun run appends a script's extra arguments to the last command of its && chain.
export function withForwarded(steps: readonly Step[], forwarded: readonly string[]): readonly Step[] {
  const last = steps.at(-1);
  if (last === undefined || forwarded.length === 0) return steps;
  return [...steps.slice(0, -1), [...last, ...forwarded]];
}

const runStep = Effect.fn("runStep")(function* ([program, ...args]: Step) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .exitCode(ChildProcess.make(program, args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }))
    .pipe(Effect.catch((cause) => Console.error(`${program}: ${cause.message}`).pipe(Effect.as(NOT_FOUND))));
});

export const runSteps = Effect.fn("runSteps")(function* (steps: readonly Step[]) {
  for (const step of steps) {
    const code: number = yield* runStep(step);
    if (code !== PASSED) return code;
  }
  return PASSED;
});

export function runStepsMain(steps: readonly Step[]): void {
  runExitMain(runSteps(withForwarded(steps, process.argv.slice(2))));
}
