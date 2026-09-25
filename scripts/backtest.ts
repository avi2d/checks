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

type Commit = {
  readonly sha: string;
  readonly parent: string;
  readonly subject: string;
};

const firstParentCommits = Effect.fn("firstParentCommits")(function* (count: string) {
  return (yield* git(["log", "--first-parent", "--format=%H%x09%P%x09%s", "-n", count]))
    .trim()
    .split("\n")
    .map((row): Commit => {
      const [sha = "", parents = "", subject = ""] = row.split("\t");
      return { sha, parent: parents.split(" ")[0] ?? "", subject };
    })
    .filter((commit) => commit.sha !== "" && commit.parent !== "");
});

const addedLines = Effect.fn("addedLines")(function* ({ sha, parent }: Commit, changed: readonly string[]) {
  const numstat = (yield* git(["diff", "--numstat", parent, sha, "--", ...changed])).trim();
  return numstat === "" ? 0 : numstat.split("\n").reduce((sum, row) => sum + Number(row.split("\t")[0] ?? 0), 0);
});

const pathLanded = Effect.fn("pathLanded")(function* ({ sha, parent }: Commit, path: string) {
  const after = yield* at(sha, path);
  if (Option.isNone(after)) return { comments: 0, refusals: [] };
  const before = Option.getOrElse(yield* at(parent, path), () => "");

  const wasRefused = new Set((yield* refused(path, before)).map(withoutLine));
  const refusals = (yield* refused(path, after.value)).filter((refusal) => !wasRefused.has(withoutLine(refusal)));

  const wasComment = new Set((yield* comments(path, before)).map((one) => one.text));
  const added = (yield* comments(path, after.value)).filter((one) => !wasComment.has(one.text));
  return { comments: added.reduce((sum, one) => sum + one.text.split("\n").length, 0), refusals };
});

const commitLanded = Effect.fn("commitLanded")(function* (commit: Commit) {
  const changed = (yield* git(["diff", "--name-only", "--diff-filter=d", commit.parent, commit.sha]))
    .trim()
    .split("\n")
    .filter((path) => path !== "" && readable(path));
  if (changed.length === 0) return Option.none<Landed>();

  const added = yield* addedLines(commit, changed);
  let commentLines = 0;
  const refusals: string[] = [];
  for (const path of changed) {
    const one = yield* pathLanded(commit, path);
    commentLines += one.comments;
    refusals.push(...one.refusals);
  }
  return Option.some<Landed>({ sha: commit.sha.slice(0, 7), subject: commit.subject, added, comments: commentLines, refusals });
});

function summary(landed: readonly Landed[]): string {
  const lines: string[] = [];
  const total = (pick: (one: Landed) => number): number => landed.reduce((sum, one) => sum + pick(one), 0);
  const added = total((one) => one.added);
  const commentLines = total((one) => one.comments);
  const refusalCount = total((one) => one.refusals.length);

  for (const one of landed) {
    lines.push(`${one.sha}\t${one.added}\t${one.comments}\t${one.refusals.length}\t${one.subject.slice(0, 58)}`);
  }
  lines.push(`${landed.length} commits touching code, ${added} added lines`);
  lines.push(
    `comment lines added: ${commentLines} (${((commentLines / Math.max(added, 1)) * 100).toFixed(1)}% of added lines)`,
  );
  lines.push(`refusals introduced: ${refusalCount}`);
  for (const one of landed) {
    if (one.refusals.length === 0) continue;
    lines.push(`\n  ${one.sha} ${one.subject}`);
    for (const refusal of one.refusals) lines.push(`    ${refusal}`);
  }
  return lines.join("\n");
}

export const backtest = Effect.fn("backtest")(function* (count: string) {
  const landed: Landed[] = [];
  for (const commit of yield* firstParentCommits(count)) {
    const one = yield* commitLanded(commit);
    if (Option.isSome(one)) landed.push(one.value);
  }
  return summary(landed);
});

const main = Effect.gen(function* () {
  const [count = "60", ...extra] = process.argv.slice(2);
  if (extra.length > 0) return yield* new Usage({ message: USAGE });
  yield* Console.log(yield* backtest(count));
  return true;
});

if (import.meta.main) runMain("backtest", main);
