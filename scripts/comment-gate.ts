#!/usr/bin/env bun
import { Console, Effect, Option } from "effect";
import { refused, SYNTAXES } from "./comments.ts";
import { git } from "./git.ts";
import { runMain, Usage } from "./main.ts";

export type GateResult = {
  readonly files: number;
  readonly addedLines: number;
  readonly violations: readonly string[];
};

const USAGE = "usage: comment-gate.ts <ref> | <base-ref> <head-ref>";

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

const show = (rev: string, path: string, root: string) =>
  git(["show", `${rev}:${path}`], root).pipe(Effect.option);

export const runRange = Effect.fn("runRange")(function* (root: string, base: string, head: string) {
  const diff = yield* git(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-prefix", base, head], root);
  const added = parseAddedLines(diff);
  const violations: string[] = [];
  let addedLines = 0;
  for (const [path, lines] of added) {
    addedLines += lines.size;
    if (!readable(path)) continue;
    const source = yield* show(head, path, root);
    if (Option.isNone(source)) continue;
    violations.push(...refused(path, source.value, lines));
  }
  return { files: added.size, addedLines, violations };
});

export function report({ files, addedLines, violations }: GateResult): string {
  if (violations.length === 0) {
    return `comment-gate: ${addedLines} added line(s) across ${files} file(s) carry no refused comment`;
  }
  return [`comment-gate: ${violations.length} violation(s):`, ...violations.map((one) => `  ${one}`)].join("\n");
}

const parentOf = (root: string, rev: string) =>
  git(["rev-parse", "--verify", `${rev}^`], root).pipe(Effect.map((parent) => parent.trim()));

const gate = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const root = (yield* git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  const base = second === undefined ? yield* parentOf(root, first) : first;
  const result = yield* runRange(root, base, second ?? first);

  yield* Console.log(report(result));
  return result.violations.length === 0;
});

if (import.meta.main) runMain("comment-gate", gate);
