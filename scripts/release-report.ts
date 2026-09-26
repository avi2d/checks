#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { groupOf } from "./changelog.ts";
import { git } from "./git.ts";
import { runMain, Usage } from "./main.ts";

export class ReleaseReportUnreadable extends Schema.TaggedError<ReleaseReportUnreadable>()("ReleaseReportUnreadable", {
  message: Schema.String,
}) {}

const USAGE = "usage: release-report.ts";
const TAG_PREFIX = "v";

export function unreleasedOf(subjects: readonly string[]): readonly string[] {
  return subjects.filter((subject) => groupOf(subject) !== undefined);
}

export function formatReport(unreleased: readonly string[], since: string | undefined): string {
  const where = since === undefined ? "with no tag yet" : `since ${since}`;
  if (unreleased.length === 0) return `release-report: no unreleased changes ${where}`;
  return [`release-report: ${unreleased.length} unreleased change(s) ${where}:`, ...unreleased.map((subject) => `  ${subject}`)].join("\n");
}

const lastTag = Effect.fn("lastTag")(function* (root: string) {
  const described = yield* git(["describe", "--tags", "--abbrev=0", "HEAD"], root).pipe(
    Effect.map((tag) => tag.trim()),
    Effect.catchTag("GitFailure", () => Effect.succeed("")),
  );
  return described === "" ? undefined : described;
});

const subjectsSince = Effect.fn("subjectsSince")(function* (root: string, since: string | undefined) {
  const range = since === undefined ? "HEAD" : `${since}..HEAD`;
  const log = yield* git(["log", "--topo-order", "--no-merges", "--format=%s", range], root);
  return log.split("\n").filter((subject) => subject !== "");
});

const report = Effect.gen(function* () {
  if (process.argv.slice(2).length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if ((yield* git(["rev-parse", "--is-shallow-repository"], root)).trim() === "true") {
    return yield* new ReleaseReportUnreadable({ message: "the checkout is shallow, so the tag it sees may not be the last one; fetch all of it" });
  }
  const since = yield* lastTag(root);
  if (since !== undefined && !since.startsWith(TAG_PREFIX)) {
    return yield* new ReleaseReportUnreadable({ message: `${since} is the last tag, and a release tag opens with ${TAG_PREFIX}` });
  }
  const unreleased = unreleasedOf(yield* subjectsSince(root, since));
  yield* Console.log(formatReport(unreleased, since));
  return unreleased.length === 0;
});

if (import.meta.main) runMain("checks-release-report", report);
