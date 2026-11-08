import { Effect, Schema } from "effect";
import { changedPaths, defaultBranch, git, pathsOf, rangeEnds } from "../core/git.ts";

class BaseUnresolved extends Schema.TaggedError<BaseUnresolved>()("BaseUnresolved", {
  message: Schema.String,
}) {}

const splitZero = (output: string): readonly string[] => output.split("\0").filter((line) => line !== "");

// A deleted or renamed-away path stays, so the tests that still import it run.
export const changedLocalPaths = Effect.fn("changedLocalPaths")(function* (root: string) {
  const target = "origin/" + (yield* defaultBranch(root));
  const range = yield* rangeEnds(target, "HEAD", root).pipe(
    Effect.mapError((cause) => new BaseUnresolved({
      message: "cannot find where HEAD branched from " + target + ", so the test files the change reaches are unknown; fetch " + target + " and run again: " + cause.message,
    })),
  );
  const committed = (yield* changedPaths(range.base, range.head, [], root)).flatMap(pathsOf);
  const working = splitZero(yield* git(["diff", "--name-only", "-z", "--no-renames", "HEAD", "--"], root));
  const untracked = splitZero(yield* git(["ls-files", "--others", "--exclude-standard", "-z"], root));
  return [...new Set([...committed, ...working, ...untracked])].sort();
});
