#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { changedPaths, git } from "../src/core/git.ts";
import { runMain } from "../src/core/main.ts";

const NAME = "e2e-skip";

export function skipsE2e(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) => path === "copy.json" || path.toLowerCase().endsWith(".md"));
}

// The verdict goes to stdout as one line, so a step appends it to GITHUB_OUTPUT; the detail goes to stderr.
const check = Effect.gen(function* () {
  const [base, head] = process.argv.slice(2);
  if (base === undefined || head === undefined) {
    yield* Console.error(NAME + ": no range is given, so the e2e tier runs");
    yield* Console.log("e2e-skip=false");
    return true;
  }
  const mergeBase = (yield* git(["merge-base", base, head])).trim();
  const changes = yield* changedPaths(mergeBase, head, []);
  const paths = changes.flatMap((change) => (change.kind === "renamed" ? [change.from, change.path] : [change.path]));
  const skip = skipsE2e(paths);
  if (paths.length === 0) {
    yield* Console.error(NAME + ": the range changes no file, so the e2e tier runs");
  } else if (skip) {
    yield* Console.error(NAME + ": " + paths.length + " changed file(s) are all Markdown or the root copy.json, so the e2e tier can skip");
  } else {
    yield* Console.error(NAME + ": a changed file needs the e2e tier");
  }
  yield* Console.log("e2e-skip=" + skip);
  return true;
});

if (import.meta.main) runMain(NAME, check);
