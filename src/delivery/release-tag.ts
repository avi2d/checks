#!/usr/bin/env bun
import { Effect } from "effect";
import { runningWorkflow } from "./release.ts";
import { tagHead } from "./release-tagging.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const USAGE = "usage: release-tag.ts <workflow>";

const releaseTag = Effect.gen(function* () {
  const [workflow, ...extra] = process.argv.slice(2);
  if (workflow === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  return yield* tagHead("release-tag", (yield* git(["rev-parse", "--show-toplevel"])).trim(), workflow, yield* runningWorkflow);
});

if (import.meta.main) runMain("checks-release-tag", releaseTag);
