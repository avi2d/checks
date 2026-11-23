#!/usr/bin/env bun
import { Console, Effect, Option, Schema } from "effect";
import { gitHubOptional, REPOSITORY } from "../core/github.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { MANIFEST, releaseTag } from "../core/release-names.ts";
import { extractReleaseNotes } from "./release-notes.ts";
import { taggedOn } from "./release-tagging.ts";

const NAME = "production-gate";
const USAGE = "usage: production-gate.ts [<commit>]";

class GateFailed extends Schema.TaggedError<GateFailed>()("GateFailed", {
  message: Schema.String,
}) {}

const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));
const decodeRelease = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ prerelease: Schema.Boolean, body: Schema.NullOr(Schema.String) })),
);

const publishedRelease = (tag: string) => gitHubOptional(decodeRelease, "GET", `${REPOSITORY}/releases/tags/${tag}`);

const fileAt = (commit: string, file: string) =>
  git(["show", `${commit}:${file}`]).pipe(Effect.mapError(() => new GateFailed({ message: `${commit.slice(0, 12)} holds no ${file}` })));

// Returns what keeps the commit out of production, or undefined when it is a published release.
const flawOf = Effect.fn("flawOf")(function* (commit: string) {
  const { version } = yield* decodeVersion(yield* fileAt(commit, MANIFEST)).pipe(
    Effect.mapError((cause) => new GateFailed({ message: `${MANIFEST} at ${commit.slice(0, 12)}: ${cause.message}` })),
  );
  const tag = releaseTag(version);
  const tagged = yield* taggedOn(tag);
  if (tagged !== commit) return { tag, flaw: tagged === undefined ? `no tag ${tag}` : `${tag} on ${tagged.slice(0, 12)}, not on it` };
  const release = yield* publishedRelease(tag);
  if (Option.isNone(release)) return { tag, flaw: `the tag ${tag} but no GitHub release` };
  if (release.value.prerelease) return { tag, flaw: `only the prerelease ${tag}` };
  const section = yield* extractReleaseNotes(yield* fileAt(commit, "CHANGELOG.md"), version).pipe(Effect.option);
  if (Option.isNone(section)) return { tag, flaw: `the release ${tag}, but its CHANGELOG.md has no section for ${version}` };
  const notes = (release.value.body ?? "").replaceAll("\r\n", "\n");
  if (!notes.includes(section.value)) return { tag, flaw: `the release ${tag}, whose notes lack the CHANGELOG.md section for ${version}` };
  return { tag, flaw: undefined };
});

const gate = Effect.gen(function* () {
  const args = process.argv.slice(2);
  if (args.length > 1) return yield* new Usage({ message: USAGE });
  const commit = (yield* git(["rev-parse", "--verify", `${args[0] ?? "HEAD"}^{commit}`]).pipe(
    Effect.mapError(() => new GateFailed({ message: `${args[0] ?? "HEAD"} names no commit` })),
  )).trim();
  const { tag, flaw } = yield* flawOf(commit);
  if (flaw === undefined) {
    yield* Console.log(`${NAME}: ${commit.slice(0, 12)} is the release ${tag}, so production publishes it without running the tests again`);
    return true;
  }
  yield* Console.error(`${NAME}: production publishes only a published release, and ${commit.slice(0, 12)} has ${flaw}; merge its release pull request first`);
  return false;
});

if (import.meta.main) runMain(NAME, gate);
