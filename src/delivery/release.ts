import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { groupOf } from "./changelog.ts";
import { git } from "../core/git.ts";

class ReleaseUnreadable extends Schema.TaggedError<ReleaseUnreadable>()("ReleaseUnreadable", {
  message: Schema.String,
}) {}

class BuildFailed extends Schema.TaggedError<BuildFailed>()("BuildFailed", {
  message: Schema.String,
}) {}

export type Pending = {
  readonly since: string | undefined;
  readonly unreleased: readonly string[];
};

const RELEASE_TAG = "v[0-9]*.[0-9]*.[0-9]*";
const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_SUBJECT = /^chore: release (\d+\.\d+\.\d+)(?: \(#\d+\))?$/;

export function unreleasedOf(subjects: readonly string[]): readonly string[] {
  return subjects.filter((subject) => groupOf(subject) !== undefined);
}

// Under 0.x a breaking change moves the minor, as semver leaves a 0.x version free to break.
export function nextVersion(version: string, unreleased: readonly string[]): string | undefined {
  const [, major, minor, patch] = PLAIN_VERSION.exec(version)?.map(Number) ?? [];
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  const groups = new Set(unreleased.map(groupOf));
  if (groups.has("Breaking changes") && major > 0) return `${major + 1}.0.0`;
  if (groups.has("Breaking changes") || groups.has("Features")) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Rewrites only the version's own text, so the rest of the manifest keeps the formatting its repository gave it.
export function withVersion(manifest: string, from: string, to: string): string | undefined {
  const field = new RegExp(`("version"\\s*:\\s*")${from.replaceAll(".", "\\.")}(")`);
  return field.test(manifest) ? manifest.replace(field, `$1${to}$2`) : undefined;
}

export function releaseTitle(version: string): string {
  return `chore: release ${version}`;
}

export function releasedVersionOf(subject: string): string | undefined {
  return RELEASE_SUBJECT.exec(subject)?.[1];
}

export const runBuild = Effect.fn("runBuild")(function* (root: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(process.execPath, ["run", "build"], { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit" }),
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* new BuildFailed({ message: `bun run build exited ${exitCode}` });
});

export const lastTag = Effect.fn("lastTag")(function* (root: string) {
  const described = yield* git(["describe", "--tags", "--abbrev=0", `--match=${RELEASE_TAG}`, "HEAD"], root).pipe(
    Effect.map((tag) => tag.trim()),
    Effect.catchTag("GitFailure", () => Effect.succeed("")),
  );
  return described === "" ? undefined : described;
});

const subjectsSince = Effect.fn("subjectsSince")(function* (root: string, since: string | undefined) {
  const range = since === undefined ? "HEAD" : `${since}..HEAD`;
  const log = yield* git(["log", "--topo-order", "--no-merges", "--format=%s", range], root);
  return log.split("\n").filter((subject) => subject !== "");
});

export const readPending = Effect.fn("readPending")(function* (root: string) {
  if ((yield* git(["rev-parse", "--is-shallow-repository"], root)).trim() === "true") {
    return yield* new ReleaseUnreadable({ message: "the checkout is shallow, so the tag it sees may not be the last one; fetch all of it" });
  }
  const since = yield* lastTag(root);
  return { since, unreleased: unreleasedOf(yield* subjectsSince(root, since)) } satisfies Pending;
});
