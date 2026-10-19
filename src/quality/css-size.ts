#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { runTreeGate } from "../core/main.ts";
import { SOURCE_LIMITS } from "./presets/oxlint.ts";

export type Violation = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

const NAME = "css-size";

const LIMIT = SOURCE_LIMITS["max-lines"];

const STYLESHEET = /\.css$/;

const GENERATED = "dist/";

export function isExempt(file: string): boolean {
  if (!STYLESHEET.test(file)) return true;
  return file.startsWith(GENERATED);
}

export function lineCount(source: string): number {
  if (source === "") return 0;
  const parts = source.split("\n");
  return source.endsWith("\n") ? parts.length - 1 : parts.length;
}

export function violationsOf(entries: readonly { readonly file: string; readonly lines: number }[]): readonly Violation[] {
  return entries
    .filter(({ lines }) => lines > LIMIT)
    .toSorted((a, b) => (a.file < b.file ? -1 : 1))
    .map(({ file, lines }) => ({
      file,
      line: undefined,
      message: `${lines} lines, over the ${LIMIT}-line budget; split the stylesheet into smaller files`,
    }));
}

class CssSizeError extends Schema.TaggedError<CssSizeError>()("CssSizeError", {
  message: Schema.String,
}) {}

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

const listJudged = Effect.fn("listJudged")(function* (root: string) {
  const listed = yield* workingTreeFiles(root).pipe(
    Effect.mapError((cause) => new CssSizeError({ message: cause.message })),
  );
  return listed.filter((file) => !isExempt(file)).toSorted();
});

const measure = Effect.fn("measure")(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString(path.join(root, file)).pipe(
    Effect.mapError((cause) => new CssSizeError({ message: `cannot read ${file}: ${String(cause)}` })),
  );
  return { file, lines: lineCount(source) };
});

export const run = Effect.fn("run")(function* (root: string) {
  const judged = yield* listJudged(root);
  const entries = yield* Effect.forEach(judged, (file) => measure(root, file), { concurrency: "unbounded" });
  return { files: judged.length, violations: violationsOf(entries) } satisfies Result;
});

export function report({ files, violations }: Result): string {
  if (violations.length === 0) return `${NAME}: no stylesheet over ${LIMIT} lines among ${files} CSS file(s)`;
  return [`${NAME}: ${violations.length} violation(s)`, ...violations.map(({ file, message }) => `  ${file}: ${message}`)].join("\n");
}

if (import.meta.main) runTreeGate(NAME, run, report);
