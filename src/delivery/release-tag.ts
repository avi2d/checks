#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { dispatch } from "./github.ts";
import { releasedVersionOf } from "./release.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

class TagRefused extends Schema.TaggedError<TagRefused>()("TagRefused", {
  message: Schema.String,
}) {}

const NAME = "checks-release-tag";
const USAGE = "usage: release-tag.ts <workflow>";
const MANIFEST = "package.json";

const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

// An annotated tag lists its own object first and the commit it tags on a `^{}` line after it.
export function taggedCommitOf(listed: string): string | undefined {
  const lines = listed.split("\n").filter((line) => line !== "");
  const peeled = lines.find((line) => line.endsWith("^{}")) ?? lines[0];
  return peeled?.split("\t")[0];
}

const releaseTag = Effect.gen(function* () {
  const [workflow, ...extra] = process.argv.slice(2);
  if (workflow === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const version = releasedVersionOf(subject);
  if (version === undefined) {
    yield* Console.log(`release-tag: ${head.slice(0, 12)} is no release commit`);
    return true;
  }
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { version: held } = yield* decodeVersion(manifest).pipe(Effect.mapError((cause) => new TagRefused({ message: `${MANIFEST}: ${cause.message}` })));
  if (held !== version) return yield* new TagRefused({ message: `${head.slice(0, 12)} releases ${version}, but ${MANIFEST} holds ${held}` });
  const tag = `v${version}`;
  const tagged = taggedCommitOf(yield* git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root));
  if (tagged === head) {
    yield* Console.log(`release-tag: ${tag} already tags ${head.slice(0, 12)}`);
    return true;
  }
  if (tagged !== undefined) return yield* new TagRefused({ message: `${tag} already tags ${tagged.slice(0, 12)}, not ${head.slice(0, 12)}` });
  yield* git(["push", "--quiet", "origin", `${head}:refs/tags/${tag}`], root);
  yield* dispatch(workflow, tag);
  yield* Console.log(`release-tag: tagged ${head.slice(0, 12)} as ${tag}, and dispatched ${workflow} on it`);
  return true;
});

if (import.meta.main) runMain(NAME, releaseTag);
