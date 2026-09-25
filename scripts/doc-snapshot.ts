import { Effect, FileSystem, Path, Schema } from "effect";
import { anchoredTargets, anchorsOf, PACKAGE_MANIFEST, packagesOf, snapshotOf, type Unresolved } from "./doc-references.ts";
import { git, pathsAt } from "./git.ts";

export class ManifestUnreadable extends Schema.TaggedError<ManifestUnreadable>()("ManifestUnreadable", {
  message: Schema.String,
}) {}

const Scripts = Schema.fromJsonString(Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }));
const decodeScripts = Schema.decodeUnknownEffect(Scripts);

export const readTexts = Effect.fn("readTexts")(function* (root: string, rev: string, paths: readonly string[]) {
  const texts = yield* Effect.forEach(paths, (path) => git(["show", `${rev}:${path}`], root), { concurrency: 8 });
  return new Map(paths.map((path, index) => [path, texts[index] ?? ""]));
});

function manifestIn(directory: string): string {
  return directory === "" ? PACKAGE_MANIFEST : `${directory}/${PACKAGE_MANIFEST}`;
}

const scriptsAt = Effect.fn("scriptsAt")(function* (root: string, rev: string, directory: string) {
  const manifest = manifestIn(directory);
  const { scripts = {} } = yield* git(["show", `${rev}:${manifest}`], root).pipe(
    Effect.flatMap(decodeScripts),
    Effect.mapError((cause) => new ManifestUnreadable({ message: `${manifest} at ${rev}: ${cause.message}` })),
  );
  return new Set(Object.keys(scripts));
});

export const snapshotAt = Effect.fn("snapshotAt")(function* (
  root: string,
  rev: string,
  docs: ReadonlyMap<string, string>,
  alsoRoots: readonly string[],
) {
  const files = yield* pathsAt(rev, [], root);
  const tracked = snapshotOf(files, new Map(), new Map());
  const targets = [...new Set([...docs].flatMap(([doc, text]) => anchoredTargets(doc, text)))].filter((path) => tracked.files.has(path));
  const read = yield* readTexts(root, rev, targets.filter((path) => !docs.has(path)));
  const anchors = new Map(targets.map((path) => [path, anchorsOf(docs.get(path) ?? read.get(path) ?? "")]));
  const packages = packagesOf([...docs.keys()], tracked);
  const scripts = yield* Effect.forEach(packages, (directory) => scriptsAt(root, rev, directory), { concurrency: 8 });
  return snapshotOf(files, anchors, new Map(packages.map((directory, index) => [directory, scripts[index] ?? new Set<string>()])), alsoRoots);
});

const ignored = (root: string, path: string) =>
  git(["check-ignore", "-q", "--no-index", "--", path], root).pipe(
    Effect.as(true),
    Effect.catchTag("GitFailure", () => Effect.succeed(false)),
  );

// A script bun runs from an installed dependency's bin names no entry in package.json.
const installedBin = Effect.fn("installedBin")(function* (root: string, directory: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bins = [...new Set([directory, ""])].map((from) => path.join(root, from, "node_modules", ".bin", name));
  const found = yield* Effect.forEach(bins, (bin) => fs.exists(bin).pipe(Effect.orElseSucceed(() => false)));
  return found.some(Boolean);
});

// A path git ignores is generated or fetched, so a clean checkout lacks it by design.
const stillBroken = Effect.fn("stillBroken")(function* (root: string, { missing }: Unresolved) {
  if (missing.type === "file") return !(yield* ignored(root, missing.path));
  if (missing.type === "script") return !(yield* installedBin(root, missing.packageDirectory, missing.name));
  return true;
});

export const stillMissing = Effect.fn("stillMissing")(function* (root: string, unresolved: readonly Unresolved[]) {
  return yield* Effect.forEach(unresolved, (one) => stillBroken(root, one), { concurrency: 8 });
});
