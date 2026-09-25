import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class GitFailure extends Schema.TaggedError<GitFailure>()("GitFailure", {
  message: Schema.String,
}) {}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

export type Feed = {
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
};

// Both pipes drain while the program runs: one left unread fills its buffer and stalls it.
export const collect = Effect.fn("collect")(
  function* (program: string, args: readonly string[], cwd?: string, { env, input }: Feed = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stdin = input === undefined ? undefined : Stream.make(new TextEncoder().encode(input));
    const handle = yield* spawner.spawn(ChildProcess.make(program, args, { cwd, env, extendEnv: true, stdin }));
    const [stdout, stderr, exitCode] = yield* Effect.all([text(handle.stdout), text(handle.stderr), handle.exitCode], {
      concurrency: "unbounded",
    });
    return { stdout, stderr, exitCode };
  },
  Effect.scoped,
);

export const git = Effect.fn("git")(function* (args: readonly string[], cwd?: string, feed?: Feed) {
  const failed = (reason: string): GitFailure => new GitFailure({ message: `git ${args.join(" ")}: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("git", args, cwd, feed).pipe(
    Effect.mapError((cause) => failed(cause.message)),
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
  return stdout;
});

export type Change =
  | { readonly kind: "written" | "deleted"; readonly path: string }
  | { readonly kind: "renamed"; readonly from: string; readonly path: string; readonly edited: boolean };

const UNCHANGED_RENAME = "R100";

function parseNameStatus(output: string): readonly Change[] {
  const fields = output.split("\0");
  const changes: Change[] = [];
  let index = 0;
  while (index < fields.length - 1) {
    const status = fields[index] ?? "";
    if (status.startsWith("R")) {
      changes.push({ kind: "renamed", from: fields[index + 1] ?? "", path: fields[index + 2] ?? "", edited: status !== UNCHANGED_RENAME });
      index += 3;
    } else if (status.startsWith("C")) {
      changes.push({ kind: "written", path: fields[index + 2] ?? "" });
      index += 3;
    } else {
      changes.push({ kind: status === "D" ? "deleted" : "written", path: fields[index + 1] ?? "" });
      index += 2;
    }
  }
  return changes;
}

export const changedPaths = Effect.fn("changedPaths")(function* (
  base: string,
  head: string,
  pathspecs: readonly string[],
  cwd?: string,
) {
  return parseNameStatus(yield* git(["diff", "--name-status", "-z", "-M", base, head, "--", ...pathspecs], cwd));
});

function newPathOf(line: string): string | undefined {
  const path = line.startsWith("+++ b/") ? line.slice("+++ b/".length) : line.slice("+++ ".length);
  return path === "/dev/null" ? undefined : path;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  let path: string | undefined;
  let line = 0;
  let inHunk = false;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      path = newPathOf(row);
      inHunk = false;
      continue;
    }
    const hunk = HUNK.exec(row);
    if (hunk !== null) {
      line = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (row.startsWith("+")) {
      let lines = added.get(path);
      if (lines === undefined) {
        lines = new Set<number>();
        added.set(path, lines);
      }
      lines.add(line);
      line += 1;
    } else if (row.startsWith("-")) {
      continue;
    } else {
      line += 1;
    }
  }
  return added;
}

export const changedLines = Effect.fn("changedLines")(function* (
  base: string,
  head: string,
  pathspecs: readonly string[],
  cwd?: string,
) {
  const diff = yield* git(
    ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-prefix", "-M", base, head, "--", ...pathspecs],
    cwd,
  );
  return parseAddedLines(diff);
});

const emptyTree = (cwd?: string) => git(["hash-object", "-t", "tree", "/dev/null"], cwd).pipe(Effect.map((sha) => sha.trim()));

export const pathsAt = Effect.fn("pathsAt")(function* (rev: string, pathspecs: readonly string[], cwd?: string) {
  const listed = yield* git(["diff", "--name-only", "-z", "--no-renames", yield* emptyTree(cwd), rev, "--", ...pathspecs], cwd);
  return listed.split("\0").filter((path) => path !== "");
});

function namesAParent(commitObject: string): boolean {
  const [headers = ""] = commitObject.split("\n\n", 1);
  return headers.split("\n").some((header) => header.startsWith("parent "));
}

// A shallow clone's boundary commit reads as parentless to rev-parse and log, and judged against
// the empty tree it would carry the whole repository; only the commit object still names its parents.
export const parentOrEmptyTree = Effect.fn("parentOrEmptyTree")(function* (rev: string, cwd?: string) {
  if (!namesAParent(yield* git(["cat-file", "commit", rev], cwd))) return yield* emptyTree(cwd);
  return (yield* git(["rev-parse", "--verify", `${rev}^`], cwd)).trim();
});

// From the base branch's tip, a range would charge the head with what the base branch changed after it branched off.
export const rangeEnds = Effect.fn("rangeEnds")(function* (first: string, second: string | undefined, cwd?: string) {
  if (second === undefined) return { base: yield* parentOrEmptyTree(first, cwd), head: first };
  return { base: (yield* git(["merge-base", first, second], cwd)).trim(), head: second };
});
