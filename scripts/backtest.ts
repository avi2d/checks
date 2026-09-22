#!/usr/bin/env bun
import { comments, refused, SYNTAXES } from "./comments.ts";

type Landed = {
  readonly sha: string;
  readonly subject: string;
  readonly added: number;
  readonly comments: number;
  readonly refusals: readonly string[];
};

const USAGE = "usage: backtest.ts [commit-count]";

const EXCLUDED = ["generated/", "vendor/", "repos/", "node_modules/", "dist/"];

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function git(...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    die(`backtest: git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function readable(path: string): boolean {
  if (EXCLUDED.some((prefix) => path.startsWith(prefix))) return false;
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return extension in SYNTAXES;
}

async function at(sha: string, path: string): Promise<string | undefined> {
  const result = Bun.spawnSync(["git", "show", `${sha}:${path}`], { stdout: "pipe", stderr: "pipe" });
  return result.success ? result.stdout.toString() : undefined;
}

function withoutLine(refusal: string): string {
  return refusal.replace(/^(\S+?):\d+ /, "$1 ");
}

export async function backtest(count: string): Promise<string> {
  const lines: string[] = [];
  const commits = git("log", "--first-parent", "--format=%H%x09%P%x09%s", "-n", count)
    .trim()
    .split("\n")
    .map((row) => {
      const [sha = "", parents = "", subject = ""] = row.split("\t");
      return { sha, parent: parents.split(" ")[0] ?? "", subject };
    })
    .filter((commit) => commit.sha !== "" && commit.parent !== "");

  const landed: Landed[] = [];

  for (const { sha, parent, subject } of commits) {
    const changed = git("diff", "--name-only", "--diff-filter=d", parent, sha)
      .trim()
      .split("\n")
      .filter((path) => path !== "" && readable(path));
    if (changed.length === 0) continue;

    const numstat = git("diff", "--numstat", parent, sha, "--", ...changed).trim();
    const added =
      numstat === ""
        ? 0
        : numstat.split("\n").reduce((sum, row) => sum + Number(row.split("\t")[0] ?? 0), 0);

    let commentLines = 0;
    const refusals: string[] = [];

    for (const path of changed) {
      const after = await at(sha, path);
      if (after === undefined) continue;
      const before = (await at(parent, path)) ?? "";

      const wasRefused = new Set(refused(path, before).map(withoutLine));
      for (const refusal of refused(path, after)) {
        if (!wasRefused.has(withoutLine(refusal))) refusals.push(refusal);
      }

      const wasComment = new Set(comments(path, before).map((one) => one.text));
      for (const one of comments(path, after)) {
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
}

if (import.meta.main) {
  const [count = "60", ...extra] = process.argv.slice(2);
  if (extra.length > 0) die(USAGE);
  console.log(await backtest(count));
}
