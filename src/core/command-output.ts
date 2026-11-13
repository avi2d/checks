import { Effect, Stream, type PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string };

export const outputOf = (
  command: ChildProcess.Command,
): Effect.Effect<Ran, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
  // Both pipes drain while the program runs: one left unread fills its buffer and stalls it.
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(command);
      const [stdout, stderr, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
        { concurrency: "unbounded" },
      );
      return { code, stdout, stderr };
    }),
  );
