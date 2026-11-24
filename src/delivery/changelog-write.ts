#!/usr/bin/env bun
import { Config, Console, DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { cuts, hasEntries, namesPullRequest, releaseDates, renderChangelog, type Bump, type Cut, type Release } from "./changelog.ts";
import { git } from "../core/git.ts";
import { lastTag } from "./release.ts";
import { CHANGELOG_MAINTENANCE_VERSION, MANIFEST, releasedVersionOf, TAG_PREFIX, taggedVersion } from "../core/release-names.ts";
import { runMain } from "../core/main.ts";

const NAME = "checks-changelog";
const CHANGELOG = "CHANGELOG.md";
const FIELD = "\x1f";

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

const reaches = (root: string, ancestor: string, descendant: string) =>
  git(["merge-base", "--is-ancestor", ancestor, descendant], root).pipe(
    Effect.as(true),
    Effect.catchTag("GitFailure", () => Effect.succeed(false)),
  );

// A tag publishes the newest bump of its version that it reaches, so a cancelled older bump of that version stays cancelled.
const readPublishedShas = Effect.fn("readPublishedShas")(function* (root: string, bumps: readonly Bump[]) {
  const tags = yield* git(["for-each-ref", "--format=%(refname:strip=2)", `refs/tags/${TAG_PREFIX}*`], root);
  const published = new Set<string>();
  for (const tag of tags.split("\n").filter((line) => line.startsWith(TAG_PREFIX))) {
    const version = taggedVersion(tag);
    for (const bump of bumps.filter((one) => one.version === version).toReversed()) {
      if (yield* reaches(root, bump.sha, `refs/tags/${tag}`)) {
        published.add(bump.sha);
        break;
      }
    }
  }
  return published;
});

const mergedTips = Effect.fn("mergedTips")(function* (root: string, through: string) {
  // A bump that names its pull request or sits off the first-parent chain is main's release, so no squash merge of this branch releases more under it.
  if (namesPullRequest((yield* git(["log", "-1", "--format=%s", through], root)).trim())) return [];
  if (!(yield* git(["rev-list", "--first-parent", "HEAD"], root)).split("\n").includes(through)) return [];
  const merges = yield* git(["log", "--merges", "--format=%P", `${through}..HEAD`], root);
  const tips: string[] = [];
  for (const [, ...parents] of merges.split("\n").filter((line) => line !== "").map((line) => line.split(" "))) {
    for (const parent of parents) {
      // A parent past the bump belongs to a later release, so only a parent beside it joins this one.
      if (!(yield* reaches(root, through, parent))) tips.push(parent);
    }
  }
  return tips;
});

const maintenanceSubjects = Effect.fn("maintenanceSubjects")(function* (root: string, { version, through, after }: Cut, extra: readonly string[]) {
  // The bump's parent cannot see the tag of the release being rebuilt.
  const tag = yield* lastTag(root, through === "HEAD" ? through : `${through}^`);
  const since = tag === undefined ? after : [...after, tag];
  const log = yield* git(["log", "--topo-order", "--format=%H%x1f%s", through, ...extra, "--not", ...since], root);
  return log.split("\n").flatMap((line) => {
    const separator = line.indexOf(FIELD);
    if (separator === -1) return [];
    const sha = line.slice(0, separator);
    const subject = line.slice(separator + FIELD.length);
    if (sha === through && releasedVersionOf(subject) === version) return [];
    return [subject === "" ? `commit ${sha.slice(0, 12)}` : subject];
  });
});

const releaseOf = Effect.fn("releaseOf")(function* (root: string, cut: Cut, extra: readonly string[], allowUnlisted: boolean) {
  const { version, date, through, after } = cut;
  const log = yield* git(["log", "--topo-order", "--format=%s", through, ...extra, "--not", ...after], root);
  const subjects = log.split("\n").filter((subject) => subject !== "");
  if (hasEntries(subjects)) return { version, date, subjects } satisfies Release;
  if (!allowUnlisted) return undefined;
  const maintenance = yield* maintenanceSubjects(root, cut, extra);
  if (maintenance.length === 0) return undefined;
  return { version, date, subjects: maintenance, includeUnlisted: true } satisfies Release;
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
  const bumps = yield* readBumps(root);
  const released = cuts(bumps, recorded, yield* readPublishedShas(root, bumps), pending);
  const tip = released.at(-1);
  const extra = tip === undefined || tip.through === "HEAD" ? [] : yield* mergedTips(root, tip.through);
  const requested = yield* Config.String(CHANGELOG_MAINTENANCE_VERSION).pipe(Config.withDefault(""));
  const found = (yield* Effect.forEach(released, (cut) => {
    const maintenance = cut.through === "HEAD" ? cut.version === requested : recorded.has(cut.version);
    return releaseOf(root, cut, cut === tip ? extra : [], maintenance);
  }))
    .filter((release) => release !== undefined)
    .toReversed();
  yield* fs.writeFileString(target, renderChangelog(name, found, repositoryUrl));
  yield* Console.log(`${NAME}: wrote ${found.length} release(s) to ${CHANGELOG}`);
  return true;
});

if (import.meta.main) runMain(NAME, write);
