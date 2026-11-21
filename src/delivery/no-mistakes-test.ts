#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import { runTreeGate } from "../core/main.ts";

export type Violation = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

const NAME = "no-mistakes-test";
const CONFIG = ".no-mistakes.yaml";

class NoMistakesTestError extends Schema.TaggedError<NoMistakesTestError>()("NoMistakesTestError", {
  message: Schema.String,
}) {}

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function violationsOf(config: unknown): readonly Violation[] {
  const commands = isRecord(config) ? config["commands"] : undefined;
  if (!isRecord(commands) || !Object.hasOwn(commands, "test")) return [];
  return [
    {
      file: CONFIG,
      line: undefined,
      message: `commands.test must stay absent, since the test step runs no repository test command of its own and CI runs them, found ${JSON.stringify(commands["test"] ?? null)}`,
    },
  ];
}

export const run = Effect.fn("run")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const configFile = (yield* Path.Path).join(root, CONFIG);
  if (!(yield* fs.exists(configFile))) return { files: 0, violations: [] } satisfies Result;
  const text = yield* fs.readFileString(configFile).pipe(
    Effect.mapError((cause) => new NoMistakesTestError({ message: `cannot read ${configFile}: ${cause.message}` })),
  );
  const config = yield* Effect.try({
    try: (): unknown => Bun.YAML.parse(text),
    catch: (error) => new NoMistakesTestError({ message: `cannot parse ${CONFIG}: ${String(error)}` }),
  });
  return { files: 1, violations: violationsOf(config) } satisfies Result;
});

export function report({ files, violations }: Result): string {
  if (violations.length === 0) {
    return files === 0
      ? `${NAME}: no ${CONFIG}, so no test command to judge`
      : `${NAME}: ${CONFIG} sets no commands.test, so the test step runs no repository test command of its own`;
  }
  return [`${NAME}: ${violations.length} violation(s)`, ...violations.map(({ file, message }) => `  ${file}: ${message}`)].join("\n");
}

if (import.meta.main) runTreeGate(NAME, run, report);
