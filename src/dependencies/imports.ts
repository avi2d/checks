#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { collect, git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

export const PROJECT_CONFIG = "dependency-cruiser.config.ts";

export const OWN_CONFIGS = [
  ".dependency-cruiser.json",
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.ts",
  ".dependency-cruiser.cts",
  ".dependency-cruiser.mts",
] as const;

export const CRUISED = ["*.ts", "*.tsx", "*.mts", "*.cts"] as const;

const NAME = "imports";
const USAGE = "usage: imports.ts";
const KIT_DEFAULTS = "kit-defaults.ts";

class ImportsError extends Schema.TaggedError<ImportsError>()("ImportsError", {
  message: Schema.String,
}) {}

const Violation = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  rule: Schema.Struct({ name: Schema.String, severity: Schema.String }),
});

export type Violation = typeof Violation.Type;

const decodeCruise = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      summary: Schema.Struct({ violations: Schema.Array(Violation), error: Schema.Int, totalCruised: Schema.Int }),
    }),
  ),
);

export function describeViolation({ from, to, rule }: Violation): string {
  return from === to ? `  ${rule.severity} ${rule.name}: ${from}` : `  ${rule.severity} ${rule.name}: ${from} → ${to}`;
}

const configOf = Effect.fn("configOf")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of [PROJECT_CONFIG, ...OWN_CONFIGS]) {
    if (yield* fs.exists(path.join(root, name))) return { file: name, shown: name };
  }
  return { file: path.join(import.meta.dir, KIT_DEFAULTS), shown: "the kit's defaults" };
});

const depcruise = Effect.fn("depcruise")(function* () {
  const path = yield* Path.Path;
  const main = yield* Effect.try({
    try: () => new URL("../../bin/dependency-cruiser.mjs", import.meta.resolve("dependency-cruiser")),
    catch: () => new ImportsError({ message: "cannot resolve dependency-cruiser, a peer dependency of the kit" }),
  });
  return yield* path.fromFileUrl(main);
});

const imports = Effect.gen(function* () {
  if (process.argv.length > 2) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const files = (yield* git(["ls-files", "--", ...CRUISED], root)).split("\n").filter((line) => line !== "");
  if (files.length === 0) return yield* new ImportsError({ message: "no tracked TypeScript to cruise" });
  const config = yield* configOf(root);
  const run = yield* collect(process.execPath, [yield* depcruise(), "--config", config.file, "--output-type", "json", ...files], root).pipe(
    Effect.mapError((cause) => new ImportsError({ message: `cannot run dependency-cruiser: ${cause.message}` })),
  );
  const { summary } = yield* decodeCruise(run.stdout).pipe(
    Effect.mapError(() => new ImportsError({ message: `dependency-cruiser exits ${run.exitCode} with no report: ${(run.stdout + run.stderr).trim()}` })),
  );
  const cruised = `${summary.totalCruised} module(s) cruised against ${config.shown}`;
  if (summary.violations.length === 0) {
    yield* Console.log(`${NAME}: ${cruised}, no violation`);
    return true;
  }
  yield* Console.error([`${NAME}: ${summary.violations.length} violation(s) in ${cruised}`, ...summary.violations.map(describeViolation)].join("\n"));
  return summary.error === 0;
});

if (import.meta.main) runMain(NAME, imports);
