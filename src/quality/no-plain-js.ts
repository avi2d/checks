#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain } from "../core/main.ts";

export type Violation = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

const NAME = "no-plain-js";

const PLAIN_SOURCE = /\.m?js$/;

const UNJUDGED_PREFIXES = ["dist/", "node_modules/", "repos/", "public/", "tests/fixtures/"] as const;

const GENERATED_CONFIG = "dependency-cruiser.config.js";

const SHIPPED_PRESET = "stryker.preset.js";

const STRYKER_CONFIG = /^\.?stryker\.(?:conf|config)\.(?:js|mjs|cjs)$/;

function baseNameOf(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

export function isExempt(file: string): boolean {
  if (UNJUDGED_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  if (file === GENERATED_CONFIG) return true;
  const base = baseNameOf(file);
  return base === SHIPPED_PRESET || STRYKER_CONFIG.test(base);
}

export function violationsOf(files: readonly string[]): readonly Violation[] {
  return files
    .filter((file) => PLAIN_SOURCE.test(file) && !isExempt(file))
    .toSorted()
    .map((file) => ({
      file,
      line: undefined,
      message: "plain JavaScript source in a TypeScript repository; convert it to TypeScript",
    }));
}

class NoPlainJsError extends Schema.TaggedError<NoPlainJsError>()("NoPlainJsError", {
  message: Schema.String,
}) {}

const workingTreeFiles = Effect.fn("workingTreeFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listed = yield* git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root).pipe(
    Effect.mapError((cause) => new NoPlainJsError({ message: cause.message })),
  );
  return yield* Effect.filter(listed.split("\0").filter(Boolean), (file) => fs.exists(path.join(root, file)), {
    concurrency: "unbounded",
  });
});

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

export const run = Effect.fn("run")(function* (root: string) {
  const files = yield* workingTreeFiles(root);
  return { files: files.length, violations: violationsOf(files) } satisfies Result;
});

export function report({ files, violations }: Result): string {
  if (violations.length === 0) return `${NAME}: no plain JavaScript sources among ${files} tracked file(s)`;
  return [`${NAME}: ${violations.length} violation(s)`, ...violations.map(({ file, message }) => `  ${file}: ${message}`)].join("\n");
}

const noPlainJs = Effect.gen(function* () {
  const root = process.argv[2] ?? process.cwd();
  const result = yield* run(root);
  yield* Console.log(report(result));
  return result.violations.length === 0;
});

if (import.meta.main) runMain(NAME, noPlainJs);
