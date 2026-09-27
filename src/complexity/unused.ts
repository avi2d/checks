#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { collect, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";

export type Scan = { readonly tracked: number; readonly files: readonly string[] };

const NAME = "unused";
const CONFIGS = [
  ".knip.json",
  ".knip.jsonc",
  "knip.json",
  "knip.jsonc",
  "knip.js",
  "knip.ts",
  "knip.config.js",
  "knip.config.ts",
] as const;
const TYPESCRIPT = ["*.ts", "*.tsx"];
const JUDGED = /\.tsx?$/;

class UnusedError extends Schema.TaggedError<UnusedError>()("UnusedError", {
  message: Schema.String,
}) {}

const decodeKnipReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      issues: Schema.Array(Schema.Struct({ files: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))) })),
    }),
  ),
);

export const filesOf = Effect.fn("filesOf")(function* (stdout: string) {
  const { issues } = yield* decodeKnipReport(stdout).pipe(
    Effect.mapError((cause) => new UnusedError({ message: `knip's JSON report does not decode: ${cause.message}` })),
  );
  return issues
    .flatMap(({ files = [] }) => files.map(({ name }) => name))
    .filter((file) => JUDGED.test(file))
    .toSorted();
});

export function report({ tracked, files }: Scan): string {
  if (files.length === 0) return `${NAME}: no unreferenced files among ${tracked} tracked .ts/.tsx file(s)`;
  return [`${NAME}: ${files.length} unreferenced file(s):`, ...files.map((file) => `  ${file}`)].join("\n");
}

const hasConfig = Effect.fn("hasConfig")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of CONFIGS) {
    if (yield* fs.exists(path.join(root, name))) return true;
  }
  const manifest: unknown = yield* fs.readFileString(path.join(root, "package.json")).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => new UnusedError({ message: "package.json does not parse as JSON" }),
      })
    ),
  );
  return typeof manifest === "object" && manifest !== null && "knip" in manifest;
});

const knip = Effect.fn("knip")(function* () {
  const path = yield* Path.Path;
  const main = yield* Effect.try({
    try: () => new URL("../bin/knip.js", import.meta.resolve("knip")),
    catch: () => new UnusedError({ message: "cannot resolve knip from the installed kit" }),
  });
  return yield* path.fromFileUrl(main);
});

const unused = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const tracked = (yield* git(["ls-files", "--", ...TYPESCRIPT], root))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (tracked.length === 0) return yield* new UnusedError({ message: "no tracked .ts or .tsx files to scan" });
  if (!(yield* hasConfig(root))) {
    yield* Console.log(`${NAME}: no knip configuration names entry files, so add one extending the kit's knip-base.json`);
    return false;
  }
  const run = yield* collect(process.execPath, [yield* knip(), "--reporter", "json"], root).pipe(
    Effect.mapError((cause) => new UnusedError({ message: `cannot run knip: ${cause.message}` })),
  );
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    return yield* new UnusedError({ message: `knip exits ${run.exitCode}: ${(run.stdout + run.stderr).trim()}` });
  }
  const files = yield* filesOf(run.stdout);
  yield* Console.log(report({ tracked: tracked.length, files }));
  return files.length === 0;
});

if (import.meta.main) runMain(NAME, unused);
