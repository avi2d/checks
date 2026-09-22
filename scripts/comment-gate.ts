#!/usr/bin/env bun
import { refused, SYNTAXES } from "./comments.ts";

export type GateResult = {
  readonly files: number;
  readonly addedLines: number;
  readonly violations: readonly string[];
};

const USAGE = "usage: comment-gate.ts <ref> | <base-ref> <head-ref>";

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function git(root: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    die(`comment-gate: git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function readable(path: string): boolean {
  return path.slice(path.lastIndexOf(".") + 1) in SYNTAXES;
}

function newPathOf(line: string): string | undefined {
  const path = line.startsWith("+++ b/") ? line.slice("+++ b/".length) : line.slice("+++ ".length);
  return path === "/dev/null" ? undefined : path;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  let path: string | undefined;
  let line = 0;
  let inHunk = false;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      path = newPathOf(row);
      inHunk = false;
      continue;
    }
    const hunk = HUNK.exec(row);
    if (hunk !== null) {
      line = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (row.startsWith("+")) {
      let lines = added.get(path);
      if (lines === undefined) {
        lines = new Set<number>();
        added.set(path, lines);
      }
      lines.add(line);
      line += 1;
    } else if (row.startsWith("-")) {
      continue;
    } else {
      line += 1;
    }
  }
  return added;
}

function show(rev: string, path: string, root: string): string | undefined {
  const result = Bun.spawnSync(["git", "show", `${rev}:${path}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.success ? result.stdout.toString() : undefined;
}

export function runRange(root: string, base: string, head: string): GateResult {
  const diff = git(root, "-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-prefix", base, head);
  const added = parseAddedLines(diff);
  const violations: string[] = [];
  let addedLines = 0;
  for (const [path, lines] of added) {
    addedLines += lines.size;
    if (!readable(path)) continue;
    const source = show(head, path, root);
    if (source === undefined) continue;
    violations.push(...refused(path, source, lines));
  }
  return { files: added.size, addedLines, violations };
}

export function report({ files, addedLines, violations }: GateResult): string {
  if (violations.length === 0) {
    return `comment-gate: ${addedLines} added line(s) across ${files} file(s) carry no refused comment`;
  }
  return [`comment-gate: ${violations.length} violation(s):`, ...violations.map((one) => `  ${one}`)].join("\n");
}

function parentOf(root: string, rev: string): string {
  return git(root, "rev-parse", "--verify", `${rev}^`).trim();
}

if (import.meta.main) {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) die(USAGE);

  const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim();
  const result =
    second !== undefined ? runRange(root, first, second) : runRange(root, parentOf(root, first), first);

  console.log(report(result));
  process.exit(result.violations.length === 0 ? 0 : 1);
}
