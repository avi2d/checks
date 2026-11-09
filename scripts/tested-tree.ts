#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git } from "../src/core/git.ts";
import { runMain } from "../src/core/main.ts";
import { MANIFEST, taggedVersion } from "../src/core/release-names.ts";
import { lastTag, releasedVersionOf } from "../src/delivery/release.ts";

const NAME = "tested-tree";

class TreeRefused extends Schema.TaggedError<TreeRefused>()("TreeRefused", {
  message: Schema.String,
}) {}

// The squash merge names the pull request it landed.
const PULL_NUMBER = / \(#(\d+)\)$/;

const check = Effect.gen(function* () {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"])).split("\n");
  const version = releasedVersionOf(subject);
  if (version === undefined) {
    yield* Console.log(`${NAME}: ${head.slice(0, 12)} is no release commit`);
    return true;
  }
  const [, number = ""] = PULL_NUMBER.exec(subject) ?? [];
  if (number === "") {
    return yield* new TreeRefused({
      message: `${head.slice(0, 12)} names no pull request, so no release pull request tested it; merge the release pull request to land the release, and tag nothing by hand`,
    });
  }
  yield* git(["fetch", "--quiet", "origin", `refs/pull/${number}/head`]);
  const [landed = "", tested = ""] = (yield* git(["rev-parse", "HEAD^{tree}", "FETCH_HEAD^{tree}"]))
    .split("\n")
    .map((line) => line.trim());
  if (landed === tested) {
    yield* Console.log(`${NAME}: ${head.slice(0, 12)} matches the tree pull request #${number} tested`);
    return true;
  }
  const since = yield* lastTag(process.cwd());
  const returned = since === undefined ? "the version it held before this release" : taggedVersion(since);
  return yield* new TreeRefused({
    message: `${head.slice(0, 12)} differs from the ${tested.slice(0, 12)} tree pull request #${number} tested, so main moved after the full run; open a \`chore: cancel the unpublished ${version}\` pull request that returns ${MANIFEST} to ${returned} and commits what \`bun run build\` then writes to CHANGELOG.md, and the next release-pr run cuts the release again with every change since ${since ?? "the first commit"}`,
  });
});

if (import.meta.main) runMain(NAME, check);
