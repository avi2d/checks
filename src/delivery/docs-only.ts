#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { changedPaths, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";

const NAME = "docs-only";

// A docs-only change touches Markdown or files under docs/ and nothing else.
export function isDocsPath(path: string): boolean {
  return path.endsWith(".md") || path.startsWith("docs/");
}

// The verdict goes to stdout as one line, so a step appends it to GITHUB_OUTPUT; the detail goes to stderr.
const check = Effect.gen(function* () {
  const [base, head] = process.argv.slice(2);
  if (base === undefined || head === undefined) {
    yield* Console.error(`${NAME}: no range is given, so the full run stays`);
    yield* Console.log("docs-only=false");
    return true;
  }
  const mergeBase = (yield* git(["merge-base", base, head])).trim();
  const changes = yield* changedPaths(mergeBase, head, []);
  const paths = changes.flatMap((change) => (change.kind === "renamed" ? [change.from, change.path] : [change.path]));
  const full = paths.filter((path) => !isDocsPath(path));
  if (paths.length > 0 && full.length === 0) {
    yield* Console.error(`${NAME}: ${paths.length} changed file(s) are all Markdown or under docs/, so the full run can skip`);
    yield* Console.log("docs-only=true");
  } else {
    yield* Console.error(`${NAME}: ${full.length} changed file(s) need the full run`);
    yield* Console.log("docs-only=false");
  }
  return true;
});

if (import.meta.main) runMain(NAME, check);
