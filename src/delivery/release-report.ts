#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { readPending } from "./release.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const USAGE = "usage: release-report.ts";

export function formatReport(unreleased: readonly string[], since: string | undefined): string {
  const where = since === undefined ? "with no tag yet" : `since ${since}`;
  if (unreleased.length === 0) return `release-report: no unreleased changes ${where}`;
  return [`release-report: ${unreleased.length} unreleased change(s) ${where}:`, ...unreleased.map((subject) => `  ${subject}`)].join("\n");
}

const report = Effect.gen(function* () {
  if (process.argv.slice(2).length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { since, unreleased } = yield* readPending(root);
  yield* Console.log(formatReport(unreleased, since));
  return unreleased.length === 0;
});

if (import.meta.main) runMain("checks-release-report", report);
