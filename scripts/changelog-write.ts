#!/usr/bin/env bun
import { Console, DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { cuts, releaseDates, renderChangelog, type Bump, type Cut, type Release } from "./changelog.ts";
import { git } from "./git.ts";
import { runMain } from "./main.ts";

const NAME = "changelog";
const CHANGELOG = "CHANGELOG.md";
const MANIFEST = "package.json";
const FIELD = "\x1f";
const TAG_PREFIX = "v";

class ChangelogUnreadable extends Schema.TaggedError<ChangelogUnreadable>()("ChangelogUnreadable", {
  message: Schema.String,
}) {}

const decodeManifestJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      version: Schema.String,
      repository: Schema.optional(Schema.Struct({ url: Schema.String })),
    }),
  ),
);

const decodeManifest = (text: string, source: string) =>
  decodeManifestJson(text).pipe(Effect.mapError((cause) => new ChangelogUnreadable({ message: `${source}: ${cause.message}` })));

const today = DateTime.nowInCurrentZone.pipe(DateTime.withCurrentZoneLocal, Effect.map(DateTime.formatIsoDate));

function repositoryWebUrl(repository: string): string {
  return repository
    .replace(/^git\+/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@([^/]+)\//, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

const versionAt = Effect.fn("versionAt")(function* (root: string, sha: string) {
  return (yield* decodeManifest(yield* git(["show", `${sha}:${MANIFEST}`], root), `${MANIFEST} at ${sha}`)).version;
});

const readBumps = Effect.fn("readBumps")(function* (root: string) {
  const log = yield* git(
    ["log", "--topo-order", "--reverse", "--full-history", "--no-merges", '-G"version"', "--format=%H%x1f%as%x1f%P", "HEAD", "--", MANIFEST],
    root,
  );
  const bumps: Bump[] = [];
  for (const line of log.split("\n")) {
    const [sha, date, parent] = line.split(FIELD);
    if (sha === undefined || date === undefined || parent === undefined) continue;
    const version = yield* versionAt(root, sha);
    if (parent === "" || (yield* versionAt(root, parent)) !== version) bumps.push({ sha, version, date });
  }
  return bumps;
});

const readPublished = Effect.fn("readPublished")(function* (root: string) {
  const tags = yield* git(["for-each-ref", "--format=%(refname:strip=2)", `refs/tags/${TAG_PREFIX}*`], root);
  return new Set(tags.split("\n").flatMap((tag) => (tag.startsWith(TAG_PREFIX) ? [tag.slice(TAG_PREFIX.length)] : [])));
});

const subjectsOf = Effect.fn("subjectsOf")(function* (root: string, { version, date, through, after }: Cut) {
  const log = yield* git(["log", "--topo-order", "--format=%s", through, "--not", ...after], root);
  return { version, date, subjects: log.split("\n").filter((subject) => subject !== "") } satisfies Release;
});

const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if ((yield* git(["rev-parse", "--is-shallow-repository"], root)).trim() === "true") {
    return yield* new ChangelogUnreadable({ message: "the checkout is shallow, so the releases reach back past its history; fetch all of it" });
  }
  const target = path.join(root, CHANGELOG);
  const { name, version, repository } = yield* decodeManifest(yield* fs.readFileString(path.join(root, MANIFEST)), MANIFEST);
  const repositoryUrl = repositoryWebUrl(repository?.url ?? (yield* git(["remote", "get-url", "origin"], root)).trim());
  const recorded = (yield* fs.exists(target)) ? releaseDates(yield* fs.readFileString(target)) : new Map<string, string>();
  const pending = version === (yield* versionAt(root, "HEAD")) ? undefined : { sha: "HEAD", version, date: yield* today };
  const released = cuts(yield* readBumps(root), recorded, yield* readPublished(root), pending);
  const found = (yield* Effect.forEach(released, (cut) => subjectsOf(root, cut))).toReversed();
  yield* fs.writeFileString(target, renderChangelog(name, found, repositoryUrl));
  yield* Console.log(`${NAME}: wrote ${found.length} release(s) to ${CHANGELOG}`);
  return true;
});

if (import.meta.main) runMain(NAME, write);
