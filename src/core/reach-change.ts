import { isDeepStrictEqual } from "node:util";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { checkoutFiles, git, pathsAt } from "./git.ts";
import { loadSettings, Reach, SETTINGS_FILE } from "./settings.ts";

export function refuseReachMap(value: unknown): string | undefined {
  const label = `${SETTINGS_FILE} reach`;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return `${label} is not a map of changed paths to test files`;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "") return `${label} has an empty changed-path key`;
    if (!Array.isArray(entry) || entry.length === 0) return `${label} lists no test file for ${key}`;
    if (entry.some((candidate) => typeof candidate !== "string" || candidate === "")) return `${label} names an empty test file for ${key}`;
  }
  return undefined;
}

export type ReachChange = { readonly kind: "full" } | { readonly kind: "mapped"; readonly patterns: readonly string[] };

export function compareReach(oldSettings: Readonly<Record<string, unknown>>, newSettings: Readonly<Record<string, unknown>>): ReachChange {
  const { reach: oldReach, ...oldOther } = oldSettings;
  const { reach: newReach, ...newOther } = newSettings;
  if (!isDeepStrictEqual(oldOther, newOther) || refuseReachMap(oldReach) !== undefined || refuseReachMap(newReach) !== undefined) return { kind: "full" };
  const oldDecoded = Schema.decodeUnknownOption(Reach)(oldReach ?? {});
  const newDecoded = Schema.decodeUnknownOption(Reach)(newReach ?? {});
  if (Option.isNone(oldDecoded) || Option.isNone(newDecoded)) return { kind: "full" };
  const before = oldDecoded.value;
  const after = newDecoded.value;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const patterns = [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key])).flatMap((key) => [...(before[key] ?? []), ...(after[key] ?? [])]);
  return { kind: "mapped", patterns };
}

export function compareLoadedSettings<E, R>(oldSettings: Effect.Effect<Readonly<Record<string, unknown>>, E, R>, newSettings: Effect.Effect<Readonly<Record<string, unknown>>, E, R>): Effect.Effect<ReachChange, never, R> {
  return Effect.gen(function* () {
    return compareReach(yield* oldSettings, yield* newSettings);
  }).pipe(Effect.result, Effect.map(Result.getOrElse((): ReachChange => ({ kind: "full" }))));
}

export function addReachTests(tests: readonly string[], selected: ReadonlySet<string>, change: ReachChange): readonly string[] {
  if (change.kind === "full") return tests;
  return tests.filter((file) => selected.has(file) || change.patterns.some((pattern) => new Bun.Glob(pattern).match(file)));
}

export const readReachChange = Effect.fn("readReachChange")(function* (root: string, base: string) {
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mergeBase = (yield* git(["merge-base", base, "HEAD"], root)).trim();
    const files = yield* pathsAt(mergeBase, [], root);
    if (!files.includes(SETTINGS_FILE) || !(yield* fs.exists(path.join(root, SETTINGS_FILE)))) return { kind: "full" } satisfies ReachChange;
    const tree = yield* checkoutFiles(mergeBase, files, yield* fs.makeTempDirectoryScoped({ prefix: "checks-reach-" }), root);
    const modules = path.join(root, "node_modules");
    if (yield* fs.exists(modules)) yield* fs.symlink(modules, path.join(tree, "node_modules"));
    return yield* compareLoadedSettings(loadSettings(tree), loadSettings(root));
  }).pipe(Effect.scoped, Effect.catchTag(["GitFailure", "PlatformError"], () => Effect.succeed<ReachChange>({ kind: "full" })));
});
