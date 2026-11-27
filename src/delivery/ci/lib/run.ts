import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Duration, Effect, Exit, Option, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// Runs a check as a CI step: a false result or a failure exits 1, and a failure prints as an error annotation.
export function runCheck<E extends { readonly message: string }>(check: Effect.Effect<boolean, E, BunServices.BunServices>): void {
  const exitCode = check.pipe(
    Effect.map((passed) => (passed ? 0 : 1)),
    Effect.catch((failure) => Console.log(`::error::${failure.message}`).pipe(Effect.as(1))),
  );
  BunRuntime.runMain(exitCode.pipe(Effect.provide(BunServices.layer)), {
    teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && typeof exit.value === "number" ? exit.value : 1),
  });
}

const writeChunk = (writer: NodeJS.WritableStream, chunk: Uint8Array) =>
  Effect.sync(() => {
    writer.write(chunk);
  });

const forwardTo = (writer: NodeJS.WritableStream) => (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  Stream.runForEach(stream, (chunk) => writeChunk(writer, chunk));

const spawnForwarded = (program: string, args: readonly string[], env: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* spawner.spawn(ChildProcess.make(program, args, { env, extendEnv: true, stdin: "inherit" }));
  });

const exitedWhenDone = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Effect.all([handle.exitCode, forwardTo(process.stdout)(handle.stdout), forwardTo(process.stderr)(handle.stderr)], {
    concurrency: "unbounded",
  }).pipe(Effect.map(([exitCode]) => Number(exitCode)));

const passedWhenDone = (handle: ChildProcessSpawner.ChildProcessHandle) => exitedWhenDone(handle).pipe(Effect.map((exitCode) => exitCode === 0));

export const commandExit = Effect.fn("commandExit")(
  function* (program: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) {
    return yield* exitedWhenDone(yield* spawnForwarded(program, args, env));
  },
  Effect.scoped,
);

export const commandPasses = Effect.fn("commandPasses")(
  function* (program: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) {
    return yield* passedWhenDone(yield* spawnForwarded(program, args, env));
  },
  Effect.scoped,
);

const quietlyPasses = Effect.fn("quietlyPasses")(
  function* (program: string, args: readonly string[]) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(program, args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
    return (yield* handle.exitCode) === ChildProcessSpawner.ExitCode(0);
  },
  Effect.scoped,
  Effect.catchTag("PlatformError", () => Effect.succeed(false)),
);

const childrenOf = (pid: string) =>
  commandOutput("pgrep", ["-P", pid]).pipe(
    Effect.map(({ stdout }) => stdout.split("\n").filter((line) => line !== "")),
    Effect.catchTag("PlatformError", () => Effect.succeed<readonly string[]>([])),
  );

const descendantsOf = (pid: string): Effect.Effect<readonly string[], never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const descendants: string[] = [];
    for (const child of yield* childrenOf(pid)) descendants.push(child, ...(yield* descendantsOf(child)));
    return descendants;
  });

const killEach = (tree: readonly string[]) =>
  Effect.forEach(tree, (pid) => Effect.try(() => process.kill(Number(pid), "SIGKILL")).pipe(Effect.catchTag("UnknownError", (error) => Console.log(`could not kill ${pid}: ${error.message}`))), { discard: true });

// A process group kill misses a descendant sudo started in its own session, and one owned by root needs sudo to stop.
const stopTree = Effect.fn("stopTree")(function* (pid: string) {
  const tree = [...(yield* descendantsOf(pid)), pid];
  if (!(yield* quietlyPasses("sudo", ["-n", "kill", "-KILL", ...tree]))) yield* killEach(tree);
});

export const commandPassesWithin = Effect.fn("commandPassesWithin")(
  function* (program: string, args: readonly string[], limit: Duration.Duration) {
    const handle = yield* spawnForwarded(program, args, {});
    const passed = yield* passedWhenDone(handle).pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)), Effect.timeoutOption(limit));
    if (Option.isSome(passed)) return passed.value;
    yield* Console.log(`${program} still ran after ${Duration.format(limit)}, so its whole process tree is stopped`);
    yield* stopTree(String(handle.pid));
    return false;
  },
  Effect.scoped,
);

export const commandOutput = Effect.fn("commandOutput")(
  function* (program: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(program, args, { env, extendEnv: true, stdin: "inherit" }));
    const [stdout, , exitCode] = yield* Effect.all(
      [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), forwardTo(process.stderr)(handle.stderr), handle.exitCode],
      { concurrency: "unbounded" },
    );
    return { stdout, passed: exitCode === ChildProcessSpawner.ExitCode(0) };
  },
  Effect.scoped,
);
