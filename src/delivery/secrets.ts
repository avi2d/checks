#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { commitOf, git, refArgs } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";
import { pinnedGitleaks, scanCommits, type Leak } from "./gitleaks.ts";

const NAME = "secrets";
const USAGE = "usage: secrets.ts <ref> | <base-ref> <head-ref>";
const SHORT_SHA = 8;

// git log reads a lone commit as its whole ancestry, so a single ref is bounded to itself.
const commitsOf = Effect.fn("commitsOf")(function* (args: readonly string[], root: string) {
  const { first, second } = yield* refArgs(args, USAGE);
  if (second === undefined) return `-1 ${yield* commitOf(first, root)}`;
  const head = yield* commitOf(second, root);
  const base = (yield* git(["merge-base", yield* commitOf(first, root), head], root)).trim();
  return `${base}..${head}`;
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

function withoutDecodedRepeats(leaks: readonly Leak[]): readonly Leak[] {
  return [...new Map(leaks.map((leak) => [`${leak.Commit}:${leak.File}:${leak.StartLine}:${leak.RuleID}`, leak])).values()];
}

export function report(leaks: readonly Leak[]): string {
  if (leaks.length === 0) return `${NAME}: the range adds no secret`;
  const secrets = withoutDecodedRepeats(leaks);
  return [
    `${NAME}: the range adds ${secrets.length} secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:`,
    ...secrets.toSorted(byPlace).map(leakLine),
  ].join("\n");
}

const secrets = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const commits = yield* commitsOf(process.argv.slice(2), root);
  const binary = yield* pinnedGitleaks(yield* cacheRoot());
  const config = path.join(import.meta.dir, "gitleaks.toml");
  const ignoreDir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-secrets-" });
  const gitDir = (yield* git(["rev-parse", "--absolute-git-dir"], root)).trim();
  const leaks = yield* scanCommits({ binary, gitDir, commits, config, ignoreDir });
  yield* Console.log(report(leaks));
  return leaks.length === 0;
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, secrets);
