import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import { Console, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { fileSeconds, reporterArgs } from "./test-report.ts";

class OrderError extends Schema.TaggedError<OrderError>()("OrderError", {
  message: Schema.String,
}) {}

const NON_RUNS: readonly string[] = ["--help", "-h", "--version"];

// With --ignoreStatic every mutant Stryker runs has covering tests, and the runner sorts those itself, so no run takes the whole list.
export function ordersTests(command: string | undefined, args: readonly string[]): boolean {
  return command === "run" && !args.some((arg) => NON_RUNS.includes(arg) || arg === "--ignoreStatic");
}

export function fastestFirst(seconds: ReadonlyMap<string, number>): readonly string[] {
  return [...seconds].toSorted(([file, time], [other, otherTime]) => time - otherTime || file.localeCompare(other)).map(([file]) => file);
}

// Bun runs ./ paths in the order given and bare paths in the order it finds them on disk, so only the ./ spelling carries the order.
// Each bare path stays listed after them, since the runner narrows a covered mutant to the bare paths alone and Bun loads a file once.
export function inRunOrder(listed: readonly string[], timed: readonly string[]): readonly string[] {
  const known = new Set(listed);
  const first = new Set(timed.filter((file) => known.has(file)));
  const rest = listed.filter((file) => !first.has(file));
  return [...[...first, ...rest].map((file) => `./${file}`), ...listed];
}

const timedFiles = Effect.fn("timedFiles")(function* (listed: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const outfile = (yield* Path.Path).join(yield* fs.makeTempDirectoryScoped({ prefix: "checks-test-order-" }), "junit.xml");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["test", ...listed.map((file) => `./${file}`), ...reporterArgs(outfile)];
  const exitCode = yield* spawner.exitCode(ChildProcess.make("bun", args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* new OrderError({ message: `bun test exited ${exitCode} while timing the unit tests` });
  return fastestFirst(yield* fileSeconds(yield* fs.readFileString(outfile)));
}, Effect.scoped);

const NodeServices = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

// With bail a static mutant runs the listed files until one fails, so the fastest files go first.
export const runOrder = (listed: readonly string[]): Promise<readonly string[]> =>
  Effect.runPromise(
    timedFiles(listed).pipe(
      Effect.map((timed) => inRunOrder(listed, timed)),
      Effect.catch((failure) => Console.error(`checks: ${failure.message}, so each static mutant runs the unit tests in Bun's default directory order`).pipe(Effect.as(listed))),
      Effect.provide(NodeServices),
    ),
  );
