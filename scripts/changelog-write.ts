#!/usr/bin/env bun
import { Console, DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { releaseDates, releases, renderChangelog, type Commit, type Cut } from "./changelog.ts";
import { VERSION } from "./doc-outline.ts";
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

const decodeManifestJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })));

const decodeManifest = (text: string, source: string) =>
  decodeManifestJson(text).pipe(Effect.mapError((cause) => new ChangelogUnreadable({ message: `${source}: ${cause.message}` })));

const today = DateTime.nowInCurrentZone.pipe(DateTime.withCurrentZoneLocal, Effect.map(DateTime.formatIsoDate));

const readHistory = Effect.fn("readHistory")(function* (root: string) {
  const log = yield* git(["log", "--first-parent", "--reverse", "--format=%H%x1f%as%x1f%s"], root);
  return log.split("\n").flatMap((line): readonly Commit[] => {
    const [sha, date, subject] = line.split(FIELD);
    return sha === undefined || date === undefined || subject === undefined ? [] : [{ sha, date, subject }];
  });
});

const readTags = Effect.fn("readTags")(function* (root: string) {
  const listed = yield* git(["for-each-ref", "--format=%(refname:strip=2)%09%(*objectname)%09%(objectname)", `refs/tags/${TAG_PREFIX}*`], root);
  return new Map(
    listed.split("\n").flatMap((line) => {
      const [name = "", peeled = "", target = ""] = line.split("\t");
      const version = name.slice(TAG_PREFIX.length);
      return name.startsWith(TAG_PREFIX) && VERSION.test(version) ? [[version, peeled === "" ? target : peeled] as const] : [];
    }),
  );
});

const versionAt = Effect.fn("versionAt")(function* (root: string, sha: string) {
  return (yield* decodeManifest(yield* git(["show", `${sha}:${MANIFEST}`], root), `${MANIFEST} at ${sha}`)).version;
});

const pendingCut = Effect.fn("pendingCut")(function* (
  root: string,
  history: readonly Commit[],
  version: string,
  tagged: ReadonlySet<string>,
  dated: ReadonlyMap<string, string>,
) {
  let bumped: Commit | undefined;
  for (const commit of history.toReversed()) {
    if (tagged.has(commit.sha) || (yield* versionAt(root, commit.sha)) !== version) break;
    bumped = commit;
  }
  const through = bumped ?? history.at(-1);
  if (through === undefined) return undefined;
  const date = dated.get(version) ?? (bumped === undefined ? yield* today : bumped.date);
  return { version, date, through: through.sha } satisfies Cut;
});

const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if ((yield* git(["rev-parse", "--is-shallow-repository"], root)).trim() === "true") {
    return yield* new ChangelogUnreadable({ message: "the checkout is shallow, so the releases reach back past its history; fetch all of it, tags included" });
  }
  const target = path.join(root, CHANGELOG);
  const { name, version } = yield* decodeManifest(yield* fs.readFileString(path.join(root, MANIFEST)), MANIFEST);
  const dated = (yield* fs.exists(target)) ? releaseDates(yield* fs.readFileString(target)) : new Map<string, string>();
  const history = yield* readHistory(root);
  const tags = yield* readTags(root);
  const tagged = [...tags].flatMap(([release, through]): readonly Cut[] => {
    const commit = history.find(({ sha }) => sha === through);
    return commit === undefined ? [] : [{ version: release, date: dated.get(release) ?? commit.date, through }];
  });
  const pending = tags.has(version) ? undefined : yield* pendingCut(root, history, version, new Set(tags.values()), dated);
  const found = releases(history, tagged, pending);
  yield* fs.writeFileString(target, renderChangelog(name, found));
  yield* Console.log(`${NAME}: wrote ${found.length} release(s) to ${CHANGELOG}`);
  return true;
});

if (import.meta.main) runMain(NAME, write);
