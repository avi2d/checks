#!/usr/bin/env bun
import type { BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { runExitMain, UNDECIDED } from "../../core/main.ts";
import { main as changes } from "./changes.ts";
import { main as commitStatus } from "./commit-status.ts";
import { main as draftHold } from "./draft-hold.ts";
import { main as heldRuns } from "./held-runs.ts";
import { runCheck } from "./lib/run.ts";
import { main as lighthouse } from "./lighthouse/lighthouse.ts";
import { main as pagesDeploy } from "./pages-deploy.ts";
import { main as pagesPublish } from "./pages-publish.ts";
import { main as pagesServed } from "./pages-served.ts";
import { main as pagesStagedCommit } from "./pages-staged-commit.ts";
import { main as playwright } from "./playwright.ts";
import { main as previewAddress } from "./preview-address.ts";
import { main as previewComment } from "./preview-comment.ts";
import { main as previewDeploy } from "./preview-deploy.ts";
import { main as previewRemove } from "./preview-remove.ts";
import { main as requireSuccess } from "./require-success.ts";

const COMMANDS = {
  changes: () => changes,
  "commit-status": () => commitStatus,
  "draft-hold": () => draftHold,
  "held-runs": () => heldRuns,
  lighthouse: () => lighthouse,
  "pages-deploy": () => pagesDeploy,
  "pages-publish": pagesPublish,
  "pages-served": () => pagesServed,
  "pages-staged-commit": () => pagesStagedCommit,
  playwright,
  "preview-address": () => previewAddress,
  "preview-comment": () => previewComment,
  "preview-deploy": () => previewDeploy,
  "preview-remove": () => previewRemove,
  "require-success": () => requireSuccess.pipe(Effect.as(true)),
} as const;

const isCommand = (name: string | undefined): name is keyof typeof COMMANDS => name !== undefined && Object.hasOwn(COMMANDS, name);

const [command, part] = process.argv.slice(2);
if (isCommand(command)) {
  const chosen: Effect.Effect<boolean, { readonly message: string }, BunServices.BunServices> = COMMANDS[command](part);
  runCheck(chosen);
} else {
  runExitMain(Console.log(`::error::checks-ci takes one of ${Object.keys(COMMANDS).join(", ")}, not ${command ?? "nothing"}`).pipe(Effect.as(UNDECIDED)));
}
