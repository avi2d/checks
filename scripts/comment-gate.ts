#!/usr/bin/env bun
import { Console, Effect, Option } from "effect";
import { refused, syntaxOf } from "./comments.ts";
import { changedLines, git, parentOrEmptyTree } from "./git.ts";
import { runMain, Usage } from "./main.ts";

export type GateResult = {
  readonly files: number;
  readonly addedLines: number;
  readonly violations: readonly string[];
};

const USAGE = "usage: comment-gate.ts <ref> | <base-ref> <head-ref>";

function readable(path: string): boolean {
  return syntaxOf(path) !== undefined;
}

const show = (rev: string, path: string, root: string) =>
  git(["show", `${rev}:${path}`], root).pipe(Effect.option);

export const runRange = Effect.fn("runRange")(function* (root: string, base: string, head: string) {
  const added = yield* changedLines(base, head, [], root);
  const violations: string[] = [];
  let lineCount = 0;
  for (const [path, lines] of added) {
    lineCount += lines.size;
    if (!readable(path)) continue;
    const source = yield* show(head, path, root);
    if (Option.isNone(source)) continue;
    violations.push(...(yield* refused(path, source.value, lines)));
  }
  return { files: added.size, addedLines: lineCount, violations };
});

export function report({ files, addedLines, violations }: GateResult): string {
  if (violations.length === 0) {
    return `comment-gate: ${addedLines} added line(s) across ${files} file(s) carry no refused comment`;
  }
  return [`comment-gate: ${violations.length} violation(s):`, ...violations.map((one) => `  ${one}`)].join("\n");
}

const gate = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const root = (yield* git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  const base = second === undefined ? yield* parentOrEmptyTree(first, root) : first;
  const result = yield* runRange(root, base, second ?? first);

  yield* Console.log(report(result));
  return result.violations.length === 0;
});

if (import.meta.main) runMain("comment-gate", gate);
