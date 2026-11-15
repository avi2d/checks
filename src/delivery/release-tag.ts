#!/usr/bin/env bun
import { Effect } from "effect";
import { runningWorkflow } from "./release.ts";
import { releaseHead, tagHead } from "./release-tagging.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const LABEL = "release-tag";
const USAGE = "usage: release-tag.ts [<workflow>]";
// The release.yml caller checks-workflows writes opens the release pull request.
const RELEASE_PR_WORKFLOW = "release";

const releaseTag = Effect.gen(function* () {
  const args = process.argv.slice(2);
  if (args.length > 1) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const [workflow] = args;
  return workflow === undefined
    ? yield* releaseHead(LABEL, root, RELEASE_PR_WORKFLOW)
    : yield* tagHead(LABEL, root, workflow, yield* runningWorkflow);
});

if (import.meta.main) runMain("checks-release-tag", releaseTag);
