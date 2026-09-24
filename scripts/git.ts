import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class GitFailure extends Schema.TaggedError<GitFailure>()("GitFailure", {
  message: Schema.String,
}) {}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

// Both pipes drain while git runs: one left unread fills its buffer and stalls git.
export const git = Effect.fn("git")(
  function* (args: readonly string[], cwd?: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = `git ${args.join(" ")}`;
    const failed = (stderr: string): GitFailure => new GitFailure({ message: `${command}: ${stderr.trim()}` });
    const handle = yield* spawner
      .spawn(ChildProcess.make("git", args, { cwd }))
      .pipe(Effect.mapError((cause) => failed(cause.message)));
    const [stdout, stderr, exitCode] = yield* Effect.all([text(handle.stdout), text(handle.stderr), handle.exitCode], {
      concurrency: "unbounded",
    }).pipe(Effect.mapError((cause) => failed(cause.message)));
    if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
    return stdout;
  },
  Effect.scoped,
);
