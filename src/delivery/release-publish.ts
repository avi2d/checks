#!/usr/bin/env bun
import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { awaitStagedVersion, stagedShasum } from "./staged-publish.ts";
import { collect } from "../core/git.ts";
import { MANIFEST } from "../core/release-names.ts";
import { runMain, Usage } from "../core/main.ts";

const NAME = "checks-release-publish";
const LABEL = "release-publish";
const USAGE = "usage: release-publish.ts";

class PublishFailed extends Schema.TaggedError<PublishFailed>()("PublishFailed", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })));
const decodeTags = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ latest: Schema.String })));
const decodeShasum = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.String));
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

const shasumOnNpm = Effect.fn("shasumOnNpm")(function* (name: string, version: string) {
  const failed = (reason: string) => new PublishFailed({ message: `npm view ${name}@${version} dist.shasum: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("npm", ["view", `${name}@${version}`, "dist.shasum", "--json"]).pipe(Effect.mapError((cause) => failed(cause.message)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return Option.isSome(decodeMissing(stdout)) ? undefined : yield* failed(stderr);
  return yield* decodeShasum(stdout).pipe(Effect.mapError((cause) => failed(cause.message)));
});

const settled = (name: string, version: string, standing: Standing, latest: string | undefined): string =>
  standing === "published"
    ? `${LABEL}: npm already holds ${name}@${version}`
    : `${LABEL}: npm already holds ${name}@${latest ?? ""}, which carries every change in ${version}, so ${version} stays off npm`;

export const publishPackage = Effect.fn("publishPackage")(function* (root: string) {
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { name, version } = yield* decodeManifest(manifest).pipe(Effect.mapError((cause) => new PublishFailed({ message: `${MANIFEST}: ${cause.message}` })));
  const before = yield* latestOnNpm(name);
  const standing = standingOf(version, before);
  if (standing !== "unpublished") {
    yield* Console.log(settled(name, version, standing, before));
    return true;
  }
  if ((yield* shasumOnNpm(name, version)) !== undefined) {
    yield* Console.log(`${LABEL}: npm already holds ${name}@${version}`);
    return true;
  }
  const result = yield* collect("npm", ["publish"], root).pipe(Effect.mapError((cause) => new PublishFailed({ message: cause.message })));
  if (result.stdout !== "") yield* Console.log(result.stdout.trimEnd());
  if (result.stderr !== "") yield* Console.error(result.stderr.trimEnd());
  if (result.exitCode === ChildProcessSpawner.ExitCode(0)) {
    yield* Console.log(`${LABEL}: published ${name}@${version}`);
    return true;
  }
  const shasum = stagedShasum(result.stderr, version);
  if (shasum !== undefined && (yield* awaitStagedVersion(shasum, () => shasumOnNpm(name, version), () => Effect.sleep("10 seconds"), 10))) {
    yield* Console.log(`${LABEL}: npm holds the staged ${name}@${version} with the same shasum`);
    return true;
  }
  return yield* new PublishFailed({ message: `npm publish refused ${name}@${version}` });
});

const releasePublish = Effect.gen(function* () {
  if (process.argv.length > 2) return yield* new Usage({ message: USAGE });
  return yield* publishPackage(process.cwd());
});

if (import.meta.main) runMain(NAME, releasePublish);
