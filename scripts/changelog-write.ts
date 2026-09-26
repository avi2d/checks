#!/usr/bin/env bun
import { Console, DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { cuts, hasEntries, releaseDates, renderChangelog, type Bump, type Cut, type Release } from "./changelog.ts";
import { git } from "./git.ts";
import { runMain } from "./main.ts";

const NAME = "checks-changelog";
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
      repository: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ url: Schema.optional(Schema.String) })])),
    }),
  ),
);

const decodeVersionJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.optional(Schema.String) })));

const decodeManifest = (text: string, source: string) =>
  decodeManifestJson(text).pipe(Effect.mapError((cause) => new ChangelogUnreadable({ message: `${source}: ${cause.message}` })));

const decodeVersion = (text: string, source: string) =>
  decodeVersionJson(text).pipe(Effect.mapError((cause) => new ChangelogUnreadable({ message: `${source}: ${cause.message}` })));

const today = DateTime.nowInCurrentZone.pipe(DateTime.withCurrentZoneLocal, Effect.map(DateTime.formatIsoDate));

function repositoryWebUrl(repository: string): string | undefined {
  const url = repository
    .replace(/^git\+/, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  return url.startsWith("https://") ? url : undefined;
}

const versionAt = Effect.fn("versionAt")(function* (root: string, sha: string) {
  const blob = (yield* git(["ls-tree", "--object-only", sha, "--", MANIFEST], root)).trim();
  if (blob === "") return undefined;
  return (yield* decodeVersion(yield* git(["cat-file", "blob", blob], root), `${MANIFEST} at ${sha}`)).version;
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
    if (version === undefined) continue;
    if (parent === "" || (yield* versionAt(root, parent)) !== version) bumps.push({ sha, version, date });
  }
  return bumps;
});

const readPublished = Effect.fn("readPublished")(function* (root: string) {
  const tags = yield* git(["for-each-ref", "--format=%(refname:strip=2)", `refs/tags/${TAG_PREFIX}*`], root);
  return new Set(tags.split("\n").flatMap((tag) => (tag.startsWith(TAG_PREFIX) ? [tag.slice(TAG_PREFIX.length)] : [])));
});

const mergedTips = Effect.fn("mergedTips")(function* (root: string, through: string) {
  // A bump off the first-parent chain came in with main, so the squash merge releases nothing more under it.
  if (!(yield* git(["rev-list", "--first-parent", "HEAD"], root)).split("\n").includes(through)) return [];
  const merges = yield* git(["log", "--merges", "--format=%P", `${through}..HEAD`], root);
  const tips: string[] = [];
  for (const [, ...parents] of merges.split("\n").filter((line) => line !== "").map((line) => line.split(" "))) {
    for (const parent of parents) {
      // A parent past the bump belongs to a later release, so only a parent beside it joins this one.
      const past = yield* git(["merge-base", "--is-ancestor", through, parent], root).pipe(
        Effect.as(true),
        Effect.catchTag("GitFailure", () => Effect.succeed(false)),
      );
      if (!past) tips.push(parent);
    }
  }
  return tips;
});

// The bump reaches no commit main gained after it, yet the squash merge releases them under it.
const subjectsOf = Effect.fn("subjectsOf")(function* (root: string, { version, date, through, after }: Cut, extra: readonly string[] = []) {
  const log = yield* git(["log", "--topo-order", "--format=%s", through, ...extra, "--not", ...after], root);
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
  const url = typeof repository === "string" ? repository : repository?.url;
  if (url === undefined) {
    return yield* new ChangelogUnreadable({ message: `${MANIFEST} has no repository.url, which the changelog links each pull request under` });
  }
  const repositoryUrl = repositoryWebUrl(url);
  if (repositoryUrl === undefined) {
    return yield* new ChangelogUnreadable({ message: `${MANIFEST} repository ${url} is no https address, which the changelog links each pull request under` });
  }
  const recorded = (yield* fs.exists(target)) ? releaseDates(yield* fs.readFileString(target)) : new Map<string, string>();
  const pending = version === (yield* versionAt(root, "HEAD")) ? undefined : { sha: "HEAD", version, date: yield* today };
  const released = cuts(yield* readBumps(root), recorded, yield* readPublished(root), pending);
  const tip = released.at(-1);
  const extra = tip === undefined || tip.through === "HEAD" ? [] : yield* mergedTips(root, tip.through);
  const found = (yield* Effect.forEach(released, (cut, index) => subjectsOf(root, cut, index === released.length - 1 ? extra : [])))
    .filter(({ subjects }) => hasEntries(subjects))
    .toReversed();
  yield* fs.writeFileString(target, renderChangelog(name, found, repositoryUrl));
  yield* Console.log(`${NAME}: wrote ${found.length} release(s) to ${CHANGELOG}`);
  return true;
});

if (import.meta.main) runMain(NAME, write);
