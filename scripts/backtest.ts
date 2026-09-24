#!/usr/bin/env bun
import { Console, Effect, Option } from "effect";
import { comments, refused, syntaxOf } from "./comments.ts";
import { git } from "./git.ts";
import { runMain, Usage } from "./main.ts";

type Landed = {
  readonly sha: string;
  readonly subject: string;
  readonly added: number;
  readonly comments: number;
  readonly refusals: readonly string[];
};

const USAGE = "usage: backtest.ts [commit-count]";

const EXCLUDED = ["generated/", "vendor/", "repos/", "node_modules/", "dist/"];

function readable(path: string): boolean {
  if (EXCLUDED.some((prefix) => path.startsWith(prefix))) return false;
  return syntaxOf(path) !== undefined;
}

const at = (sha: string, path: string) => git(["show", `${sha}:${path}`]).pipe(Effect.option);

function withoutLine(refusal: string): string {
  return refusal.replace(/^(\S+?):\d+ /, "$1 ");
}

export const backtest = Effect.fn("backtest")(function* (count: string) {
  const lines: string[] = [];
  const commits = (yield* git(["log", "--first-parent", "--format=%H%x09%P%x09%s", "-n", count]))
    .trim()
    .split("\n")
    .map((row) => {
      const [sha = "", parents = "", subject = ""] = row.split("\t");
      return { sha, parent: parents.split(" ")[0] ?? "", subject };
    })
    .filter((commit) => commit.sha !== "" && commit.parent !== "");

  const landed: Landed[] = [];

  for (const { sha, parent, subject } of commits) {
    const changed = (yield* git(["diff", "--name-only", "--diff-filter=d", parent, sha]))
      .trim()
      .split("\n")
      .filter((path) => path !== "" && readable(path));
    if (changed.length === 0) continue;

    const numstat = (yield* git(["diff", "--numstat", parent, sha, "--", ...changed])).trim();
    const added =
      numstat === ""
        ? 0
        : numstat.split("\n").reduce((sum, row) => sum + Number(row.split("\t")[0] ?? 0), 0);

    let commentLines = 0;
    const refusals: string[] = [];

    for (const path of changed) {
      const after = yield* at(sha, path);
      if (Option.isNone(after)) continue;
      const before = Option.getOrElse(yield* at(parent, path), () => "");

      const wasRefused = new Set((yield* refused(path, before)).map(withoutLine));
      for (const refusal of yield* refused(path, after.value)) {
        if (!wasRefused.has(withoutLine(refusal))) refusals.push(refusal);
      }

      const wasComment = new Set((yield* comments(path, before)).map((one) => one.text));
      for (const one of yield* comments(path, after.value)) {
        if (!wasComment.has(one.text)) commentLines += one.text.split("\n").length;
      }
    }

    landed.push({ sha: sha.slice(0, 7), subject, added, comments: commentLines, refusals });
  }

  const total = (pick: (one: Landed) => number): number => landed.reduce((sum, one) => sum + pick(one), 0);
  const addedLines = total((one) => one.added);
  const commentLines = total((one) => one.comments);
  const refusalCount = total((one) => one.refusals.length);

  for (const one of landed) {
    lines.push(`${one.sha}\t${one.added}\t${one.comments}\t${one.refusals.length}\t${one.subject.slice(0, 58)}`);
  }
  lines.push(`${landed.length} commits touching code, ${addedLines} added lines`);
  lines.push(
    `comment lines added: ${commentLines} (${((commentLines / Math.max(addedLines, 1)) * 100).toFixed(1)}% of added lines)`,
  );
  lines.push(`refusals introduced: ${refusalCount}`);
  for (const one of landed) {
    if (one.refusals.length === 0) continue;
    lines.push(`\n  ${one.sha} ${one.subject}`);
    for (const refusal of one.refusals) lines.push(`    ${refusal}`);
  }
  return lines.join("\n");
});

const main = Effect.gen(function* () {
  const [count = "60", ...extra] = process.argv.slice(2);
  if (extra.length > 0) return yield* new Usage({ message: USAGE });
  yield* Console.log(yield* backtest(count));
  return true;
});

if (import.meta.main) runMain("backtest", main);
