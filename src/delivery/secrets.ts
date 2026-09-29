#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { commitOf, git, refArgs } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";
import { pinnedGitleaks, scanCommits, type Leak } from "./gitleaks.ts";

const NAME = "secrets";
const USAGE = "usage: secrets.ts <ref> | <base-ref> <head-ref>";
const SHORT_SHA = 8;
const NEW_SIDE_PREFIX = "b/";
const OCTOPUS_PARENTS = 3;

class OctopusMerge extends Schema.TaggedError<OctopusMerge>()("OctopusMerge", {
  message: Schema.String,
}) {}

// git log reads a lone commit as its whole ancestry, so a single ref is bounded to itself.
const revisionsOf = Effect.fn("revisionsOf")(function* (args: readonly string[], root: string) {
  const { first, second } = yield* refArgs(args, USAGE);
  if (second === undefined) return ["-1", yield* commitOf(first, root)];
  const head = yield* commitOf(second, root);
  const base = (yield* git(["merge-base", yield* commitOf(first, root), head], root)).trim();
  return [`${base}..${head}`];
});

// Without --remerge-diff git log prints no diff for a merge, and a first-parent diff would rescan what the merge brings in.
// git skips --remerge-diff for an octopus merge with only a warning, so the scan would pass a commit it never read.
const logOptionsOf = Effect.fn("logOptionsOf")(function* (args: readonly string[], root: string) {
  const revisions = yield* revisionsOf(args, root);
  const [octopus] = (yield* git(["rev-list", `--min-parents=${OCTOPUS_PARENTS}`, ...revisions], root)).split("\n");
  if (octopus !== undefined && octopus !== "") {
    return yield* new OctopusMerge({
      message: `git gives no resolution diff for the octopus merge ${octopus}, so the gate cannot scan it`,
    });
  }
  return ["--remerge-diff", ...revisions].join(" ");
});

// gitleaks names a file under a remerge conflict header by its `+++ b/` line, so a path the commit does not hold carries that prefix.
const atRepositoryPath = Effect.fn("atRepositoryPath")(function* (leak: Leak, root: string) {
  if (!leak.File.startsWith(NEW_SIDE_PREFIX)) return leak;
  const held = yield* git(["cat-file", "-e", `${leak.Commit}:${leak.File}`], root).pipe(
    Effect.as(true),
    Effect.catchTag("GitFailure", () => Effect.succeed(false)),
  );
  return held ? leak : { ...leak, File: leak.File.slice(NEW_SIDE_PREFIX.length) };
});

function leakLine({ File, StartLine, RuleID, Commit, Description }: Leak): string {
  return `  ${File}:${StartLine} ${RuleID} in ${Commit.slice(0, SHORT_SHA)}: ${Description}`;
}

function byPlace(left: Leak, right: Leak): number {
  return (
    left.File.localeCompare(right.File) ||
    left.StartLine - right.StartLine ||
    left.RuleID.localeCompare(right.RuleID) ||
    left.Commit.localeCompare(right.Commit)
  );
}

export function report(leaks: readonly Leak[]): string {
  if (leaks.length === 0) return `${NAME}: the range adds no secret`;
  return [
    `${NAME}: the range adds ${leaks.length} secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:`,
    ...leaks.toSorted(byPlace).map(leakLine),
  ].join("\n");
}

const secrets = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const logOptions = yield* logOptionsOf(process.argv.slice(2), root);
  const binary = yield* pinnedGitleaks(yield* cacheRoot());
  const config = path.join(import.meta.dir, "gitleaks.toml");
  const ignoreDir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-secrets-" });
  const gitDir = (yield* git(["rev-parse", "--absolute-git-dir"], root)).trim();
  const reported = yield* scanCommits({ binary, gitDir, logOptions, config, ignoreDir });
  const leaks = yield* Effect.forEach(reported, (leak) => atRepositoryPath(leak, root));
  yield* Console.log(report(leaks));
  return leaks.length === 0;
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, secrets);
