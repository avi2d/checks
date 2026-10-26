#!/usr/bin/env bun
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { collect } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const NAME = "checks-release-publish";
const LABEL = "release-publish";
const USAGE = "usage: release-publish.ts";
const MANIFEST = "package.json";

class PublishFailed extends Schema.TaggedError<PublishFailed>()("PublishFailed", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })));
const decodeTags = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ latest: Schema.String })));
const decodeMissing = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ code: Schema.Literal("E404") }) })));

type Standing = "unpublished" | "published" | "superseded";

// npm refuses to move `latest` back to a lower version, so a version below it can only stay off npm.
function standingOf(version: string, latest: string | undefined): Standing {
  if (latest === undefined) return "unpublished";
  const order = Bun.semver.order(version, latest);
  if (order === 0) return "published";
  return order < 0 ? "superseded" : "unpublished";
}

const latestOnNpm = Effect.fn("latestOnNpm")(function* (name: string) {
  const failed = (reason: string) => new PublishFailed({ message: `npm view ${name} dist-tags: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("npm", ["view", name, "dist-tags", "--json"]).pipe(Effect.mapError((cause) => failed(cause.message)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return Option.isSome(decodeMissing(stdout)) ? undefined : yield* failed(stderr);
  return (yield* decodeTags(stdout).pipe(Effect.mapError((cause) => failed(cause.message)))).latest;
});

const npmPublish = Effect.fn("npmPublish")(
  function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make("npm", ["publish"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" }));
    return (yield* handle.exitCode) === ChildProcessSpawner.ExitCode(0);
  },
  Effect.scoped,
);

const settled = (name: string, version: string, standing: Standing, latest: string | undefined): string =>
  standing === "published"
    ? `${LABEL}: npm already holds ${name}@${version}`
    : `${LABEL}: npm already holds ${name}@${latest ?? ""}, which carries every change in ${version}, so ${version} stays off npm`;

const releasePublish = Effect.gen(function* () {
  if (process.argv.length > 2) return yield* new Usage({ message: USAGE });
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString(MANIFEST);
  const { name, version } = yield* decodeManifest(manifest).pipe(Effect.mapError((cause) => new PublishFailed({ message: `${MANIFEST}: ${cause.message}` })));
  const before = yield* latestOnNpm(name);
  const standing = standingOf(version, before);
  if (standing !== "unpublished") {
    yield* Console.log(settled(name, version, standing, before));
    return true;
  }
  if (yield* npmPublish()) {
    yield* Console.log(`${LABEL}: published ${name}@${version}`);
    return true;
  }
  // A release that published while this one ran makes npm refuse it, which leaves nothing to publish.
  const after = yield* latestOnNpm(name);
  const now = standingOf(version, after);
  if (now === "unpublished") return yield* new PublishFailed({ message: `npm publish refused ${name}@${version}` });
  yield* Console.log(settled(name, version, now, after));
  return true;
});

if (import.meta.main) runMain(NAME, releasePublish);
