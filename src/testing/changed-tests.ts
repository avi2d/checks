import { Effect, Schema } from "effect";
import { changedPaths, defaultBranch, existingFiles, git, rangeEnds, type Change } from "../core/git.ts";

const E2E_PREFIX = "tests/e2e/";
const TEST_SUFFIXES = [".test.ts", ".test.tsx"] as const;

class BaseUnresolved extends Schema.TaggedError<BaseUnresolved>()("BaseUnresolved", {
  message: Schema.String,
}) {}

export function keptPaths(changes: readonly Change[]): readonly string[] {
  return changes.filter((change) => change.kind !== "deleted").map((change) => change.path);
}

export function touchedE2eFiles(paths: readonly string[]): readonly string[] {
  const picked = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(E2E_PREFIX)) continue;
    if (!TEST_SUFFIXES.some((suffix) => path.endsWith(suffix))) continue;
    picked.add(path);
  }
  return [...picked].sort();
}

const splitZero = (output: string): readonly string[] => output.split("\0").filter((line) => line !== "");

export const changedE2eFiles = Effect.fn("changedE2eFiles")(function* (root: string) {
  const target = "origin/" + (yield* defaultBranch(root));
  const range = yield* rangeEnds(target, "HEAD", root).pipe(
    Effect.mapError((cause) => new BaseUnresolved({
      message: "cannot find where HEAD branched from " + target + ", so the e2e files the change touches are unknown; fetch " + target + " and run again: " + cause.message,
    })),
  );
  const committed = keptPaths(yield* changedPaths(range.base, range.head, [], root));
  const working = splitZero(yield* git(["diff", "--name-only", "-z", "HEAD", "--"], root));
  const untracked = splitZero(yield* git(["ls-files", "--others", "--exclude-standard", "-z"], root));
  return yield* existingFiles(root, touchedE2eFiles([...committed, ...working, ...untracked]));
});
