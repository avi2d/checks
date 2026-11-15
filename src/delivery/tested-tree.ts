#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { MANIFEST, releasedVersionOf, taggedVersion } from "../core/release-names.ts";
import { lastTag } from "./release.ts";

const NAME = "tested-tree";

class TreeRefused extends Schema.TaggedError<TreeRefused>()("TreeRefused", {
  message: Schema.String,
}) {}

// The squash merge names the pull request it landed.
const PULL_NUMBER = / \(#(\d+)\)$/;

export const checkTestedTree = Effect.fn("checkTestedTree")(function* (label: string, root: string, cuttingWorkflow: string) {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const version = releasedVersionOf(subject);
  if (version === undefined) {
    return yield* new TreeRefused({
      message: `${head.slice(0, 12)} is no release commit, so no release pull request tested it; merge the release pull request to land the release, and tag nothing by hand`,
    });
  }
  const [, number = ""] = PULL_NUMBER.exec(subject) ?? [];
  if (number === "") {
    return yield* new TreeRefused({
      message: `${head.slice(0, 12)} names no pull request, so no release pull request tested it; merge the release pull request to land the release, and tag nothing by hand`,
    });
  }
  yield* git(["fetch", "--quiet", "origin", `refs/pull/${number}/head`], root);
  const [landed = "", tested = ""] = (yield* git(["rev-parse", "HEAD^{tree}", "FETCH_HEAD^{tree}"], root))
    .split("\n")
    .map((line) => line.trim());
  if (landed === tested) {
    yield* Console.log(`${label}: ${head.slice(0, 12)} matches the tree pull request #${number} tested`);
    return true;
  }
  const pointed = (yield* git(["tag", "--points-at", "HEAD"], root)).split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (pointed.length > 0) {
    return yield* new TreeRefused({
      message: `${head.slice(0, 12)} differs from the ${tested.slice(0, 12)} tree pull request #${number} tested, so main moved after the full run; ${pointed.join(", ")} already tags this commit, so resolve that tag before the release can proceed`,
    });
  }
  const since = yield* lastTag(root);
  const returned = since === undefined ? "the version it held before this release" : taggedVersion(since);
  return yield* new TreeRefused({
    message: `${head.slice(0, 12)} differs from the ${tested.slice(0, 12)} tree pull request #${number} tested, so main moved after the full run; open a \`chore: cancel the unpublished ${version}\` pull request that returns ${MANIFEST} to ${returned} and commits what \`bun run build\` then writes to CHANGELOG.md, and the next ${cuttingWorkflow} run cuts the release again with every change since ${since ?? "the first commit"}`,
  });
});

if (import.meta.main) runMain(NAME, checkTestedTree(NAME, process.cwd(), "release-pr"));
