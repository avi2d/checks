#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git, refArgs } from "./git.ts";
import { runMain } from "./main.ts";

export const QUARANTINE = "tests/quarantine/";
export const QUARANTINE_DAYS = 30;
const DAY_SECONDS = 86400;

export class QuarantineError extends Schema.TaggedError<QuarantineError>()("QuarantineError", {
  message: Schema.String,
}) {}

const USAGE = "usage: quarantine-clock.ts <ref> | <base-ref> <head-ref>";

export type Entry =
  | { readonly kind: "entered"; readonly sha: string; readonly at: number; readonly day: string }
  | { readonly kind: "truncated" };

export type Overdue = {
  readonly file: string;
  readonly day: string;
  readonly days: number;
};

export type ClockResult = {
  readonly checked: number;
  readonly overdue: readonly Overdue[];
};

const HEADER = /^commit ([0-9a-f]{40}) (\d+) (\S+)$/;

function enteredOf(block: { readonly sha: string; readonly at: number; readonly day: string }): Entry {
  return { kind: "entered", sha: block.sha, at: block.at, day: block.day };
}

export function findEntry(output: string, file: string): Entry {
  let current = file;
  let block: { readonly sha: string; readonly at: number; readonly day: string } | undefined;
  for (const line of output.split("\n")) {
    if (line.includes("\t")) {
      if (block === undefined) continue;
      const [status = "", from = "", to = ""] = line.split("\t");
      if (status === "A" && from === current) return enteredOf(block);
      if (status.startsWith("R") && to === current) {
        if (!from.startsWith(QUARANTINE)) return enteredOf(block);
        current = from;
      }
      continue;
    }
    const header = HEADER.exec(line);
    if (header !== null) {
      block = { sha: header[1] ?? "", at: Number(header[2] ?? "0"), day: (header[3] ?? "").slice(0, "YYYY-MM-DD".length) };
    }
  }
  return { kind: "truncated" };
}

export function overdueOf(
  entries: readonly { readonly file: string; readonly at: number; readonly day: string }[],
  headAt: number,
): readonly Overdue[] {
  const limit = QUARANTINE_DAYS * DAY_SECONDS;
  return entries
    .flatMap((entry) =>
      headAt - entry.at > limit
        ? [{ file: entry.file, day: entry.day, days: Math.floor((headAt - entry.at) / DAY_SECONDS) }]
        : [],
    )
    .toSorted((a, b) => (a.file < b.file ? -1 : 1));
}

export function report({ checked, overdue }: ClockResult): string {
  if (overdue.length === 0) {
    return `quarantine-clock: no test in ${QUARANTINE} is past ${QUARANTINE_DAYS} days (${checked} checked)`;
  }
  const verb = overdue.length === 1 ? "is" : "are";
  return [
    `quarantine-clock: ${overdue.length} test(s) in ${QUARANTINE} ${verb} past ${QUARANTINE_DAYS} days; fix each and move it back, or delete it:`,
    ...overdue.map((file) => `  ${file.file} entered quarantine on ${file.day} (${file.days} days ago)`),
  ].join("\n");
}

const commitOf = Effect.fn("commitOf")(function* (rev: string) {
  return (yield* git(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
});

const filesAt = Effect.fn("filesAt")(function* (head: string) {
  const listed = yield* git(["ls-tree", "-r", "--name-only", head, "--", QUARANTINE]);
  return listed.split("\n").map((line) => line.trim()).filter((line) => line !== "");
});

const entryAt = Effect.fn("entryAt")(function* (head: string, file: string) {
  const output = yield* git(
    ["-c", "core.quotePath=false", "log", "--follow", "--name-status", "--format=commit %H %at %aI", head, "--", file],
  );
  const entry = findEntry(output, file);
  if (entry.kind === "truncated") {
    return yield* new QuarantineError({
      message: `cannot see ${file} entering ${QUARANTINE}; fetch the whole history, since a shallow clone ends before it`,
    });
  }
  return { file, at: entry.at, day: entry.day };
});

const headAt = Effect.fn("headAt")(function* (head: string) {
  const shown = yield* git(["show", "-s", "--format=%at", head]);
  const at = Number(shown.trim());
  if (!Number.isInteger(at)) return yield* new QuarantineError({ message: `cannot read when ${head} was written` });
  return at;
});

export const runHead = Effect.fn("runHead")(function* (head: string) {
  const files = yield* filesAt(head);
  const entries = yield* Effect.forEach(files, (file) => entryAt(head, file));
  return { checked: files.length, overdue: overdueOf(entries, yield* headAt(head)) } satisfies ClockResult;
});

const clock = Effect.gen(function* () {
  const { first, second } = yield* refArgs(process.argv.slice(2), USAGE);
  if (second !== undefined) yield* commitOf(first);
  const head = yield* commitOf(second ?? first);
  const result = yield* runHead(head);
  yield* Console.log(report(result));
  return result.overdue.length === 0;
});

if (import.meta.main) runMain("quarantine-clock", clock);
