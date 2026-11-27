#!/usr/bin/env bun
import type { BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { runExitMain, UNDECIDED } from "../../core/main.ts";
import { cacheRoot } from "../../dependencies/cache-root.ts";
import { pinnedGitleaks } from "../gitleaks.ts";
import { main as changes } from "./changes.ts";
import { main as commitStatus } from "./commit-status.ts";
import { main as draftHold } from "./draft-hold.ts";
import { main as githubRelease } from "./github-release.ts";
import { main as heldRuns } from "./held-runs.ts";
import { runCheck } from "./lib/run.ts";
import { main as lighthouse } from "./lighthouse/lighthouse.ts";
import { main as mutation } from "./mutation/mutation.ts";
import { main as pagesDeploy } from "./pages-deploy.ts";
import { main as pagesPublish } from "./pages-publish.ts";
import { main as pagesServed } from "./pages-served.ts";
import { main as pagesStagedCommit } from "./pages-staged-commit.ts";
import { main as playwright } from "./playwright.ts";
import { main as previewAddress } from "./preview-address.ts";
import { main as previewComment } from "./preview-comment.ts";
import { main as previewDeploy } from "./preview-deploy.ts";
import { main as previewRemove } from "./preview-remove.ts";
import { main as releaseVersion } from "./release-version.ts";
import { main as requireSuccess } from "./require-success.ts";
import { main as secretsPack } from "./secrets-pack.ts";
import { main as test } from "./test.ts";
import { main as wholeTree } from "./whole-tree.ts";

const COMMANDS = {
  changes: () => changes,
  "commit-status": () => commitStatus,
  "draft-hold": () => draftHold,
  "github-release": () => githubRelease,
  gitleaks: () => cacheRoot().pipe(Effect.flatMap(pinnedGitleaks), Effect.as(true)),
  "held-runs": () => heldRuns,
  lighthouse: () => lighthouse,
  mutation,
  "pages-deploy": () => pagesDeploy,
  "pages-publish": pagesPublish,
  "pages-served": () => pagesServed,
  "pages-staged-commit": () => pagesStagedCommit,
  playwright,
  "preview-address": () => previewAddress,
  "preview-comment": () => previewComment,
  "preview-deploy": () => previewDeploy,
  "preview-remove": () => previewRemove,
  "release-version": () => releaseVersion,
  "require-success": () => requireSuccess.pipe(Effect.as(true)),
  "secrets-pack": () => secretsPack,
  test: () => test,
  "whole-tree": wholeTree,
} as const;

const isCommand = (name: string | undefined): name is keyof typeof COMMANDS => name !== undefined && Object.hasOwn(COMMANDS, name);

const main = (): void => {
  const [command, part] = process.argv.slice(2);
  if (isCommand(command)) {
    const chosen: Effect.Effect<boolean, { readonly message: string }, BunServices.BunServices> = COMMANDS[command](part);
    runCheck(chosen);
  } else {
    runExitMain(Console.log(`::error::checks-ci takes one of ${Object.keys(COMMANDS).join(", ")}, not ${command ?? "nothing"}`).pipe(Effect.as(UNDECIDED)));
  }
};

if (import.meta.main) main();
