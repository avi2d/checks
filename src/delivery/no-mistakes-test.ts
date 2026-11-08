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
const MANIFEST = "package.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wordsOf(command: string): readonly string[] {
  return command.trim().split(/\s+/).filter((word) => word !== "");
}

function runsChanged(words: readonly string[]): boolean {
  if (!words.includes("--changed")) return false;
  if (words.includes("--full") || words.some((word) => word.startsWith("--tier="))) return false;
  return words.includes("checks-test") || words.some((word) => word === "src/testing/test.ts" || word.endsWith("/testing/test.ts"));
}

// A word split alone would pass a line that runs the suite after &&, so any shell control refuses it.
const SHELL_CONTROL = /[|&;`$()<>#\n]/;

export function isTouchedOnly(
  command: string,
  scripts: Readonly<Record<string, string>>,
  visited: readonly string[] = [],
): boolean {
  if (SHELL_CONTROL.test(command)) return false;
  const words = wordsOf(command);
  if (words.length === 0) return false;
  if (runsChanged(words)) return true;
  const [runner, verb, name] = words;
  if ((runner === "bun" || runner === "bunx") && verb === "run" && name !== undefined && !name.startsWith("-") && !visited.includes(name)) {
    const target = scripts[name];
    if (typeof target !== "string") return false;
    return isTouchedOnly(target, scripts, [...visited, name]);
  }
  return false;
}

function scriptsOf(manifest: unknown): Readonly<Record<string, string>> {
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  if (!isRecord(scripts)) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function violationsOf(config: unknown, manifest: unknown): readonly Violation[] {
  const commands = isRecord(config) ? config["commands"] : undefined;
  const test = isRecord(commands) ? commands["test"] : undefined;
  if (test === undefined) return [];
  if (typeof test === "string" && isTouchedOnly(test, scriptsOf(manifest))) return [];
  return [
    {
      file: CONFIG,
      line: undefined,
      message: `commands.test must stay absent or run only the tests the change reaches as checks-test --changed, directly or through a bun run script that runs it, found ${JSON.stringify(test ?? null)}`,
    },
  ];
}

class NoMistakesTestError extends Schema.TaggedError<NoMistakesTestError>()("NoMistakesTestError", {
  message: Schema.String,
}) {}

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

const parseYaml = (file: string, text: string): Effect.Effect<unknown, NoMistakesTestError> =>
  Effect.try({
    try: (): unknown => Bun.YAML.parse(text),
    catch: (error) => new NoMistakesTestError({ message: `cannot parse ${file}: ${String(error)}` }),
  });

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const run = Effect.fn("run")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configFile = path.join(root, CONFIG);
  if (!(yield* fs.exists(configFile))) return { files: 0, violations: [] } satisfies Result;
  const read = (file: string): Effect.Effect<string, NoMistakesTestError> =>
    fs.readFileString(file).pipe(
      Effect.mapError((cause) => new NoMistakesTestError({ message: `cannot read ${file}: ${cause.message}` })),
    );
  const config = yield* parseYaml(CONFIG, yield* read(configFile));
  const manifestFile = path.join(root, MANIFEST);
  const manifest = (yield* fs.exists(manifestFile))
    ? yield* read(manifestFile).pipe(
      Effect.flatMap((text) =>
        parseJson(text).pipe(
          Effect.mapError((cause) => new NoMistakesTestError({ message: `cannot read ${MANIFEST} as JSON: ${cause.message}` })),
        )
      ),
    )
    : undefined;
  return { files: 1, violations: violationsOf(config, manifest) } satisfies Result;
});

export function report({ files, violations }: Result): string {
  if (violations.length === 0) {
    return files === 0
      ? `${NAME}: no ${CONFIG}, so no test command to judge`
      : `${NAME}: commands.test runs only the tests the change reaches`;
  }
  return [`${NAME}: ${violations.length} violation(s)`, ...violations.map(({ file, message }) => `  ${file}: ${message}`)].join("\n");
}

if (import.meta.main) runTreeGate(NAME, run, report);
