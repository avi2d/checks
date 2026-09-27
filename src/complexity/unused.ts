#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { collect, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";

export type Scan = {
  readonly tracked: number;
  readonly files: readonly string[];
  readonly unmatched: readonly string[];
};

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
const FILES_HEADER = /^Unused files \(\d+\)$/;
const SECTION_HEADER =
  /^(?:Unused files|Unused dependencies|Unused devDependencies|Unused exports|Unused exported types|Unused enum members|Unused class members|Unused binaries|Unused unlisted|Unresolved imports|Configuration hints) \(\d+\)$/;
const REFINE_ENTRY = "Refine entry pattern";

class UnusedError extends Schema.TaggedError<UnusedError>()("UnusedError", {
  message: Schema.String,
}) {}

export function filesOf(stdout: string): readonly string[] {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => FILES_HEADER.test(line.trim()));
  if (start === -1) return [];
  const files: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line === "" || SECTION_HEADER.test(line)) return files;
    files.push(line);
  }
  return files;
}

export function unmatchedOf(diagnostics: string): readonly string[] {
  return diagnostics
    .split("\n")
    .filter((line) => line.includes(REFINE_ENTRY))
    .map((line) => line.split(/ {2,}/).at(0)?.trim() ?? "")
    .filter((pattern) => pattern !== "");
}

export function report({ tracked, files, unmatched }: Scan): string {
  if (files.length === 0 && unmatched.length === 0) return `${NAME}: no unreferenced files among ${tracked} tracked .ts/.tsx file(s)`;
  const dead = files.length === 0 ? [] : [`${NAME}: ${files.length} unreferenced file(s):`, ...files.map((file) => `  ${file}`)];
  const mistyped =
    unmatched.length === 0 ? [] : [`${NAME}: ${unmatched.length} knip entry pattern(s) match no file:`, ...unmatched.map((pattern) => `  ${pattern}`)];
  return [...dead, ...mistyped].join("\n");
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
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let directory: string | undefined = import.meta.dir;
  while (directory !== undefined) {
    const root = path.join(directory, "node_modules", "knip");
    if (yield* fs.exists(path.join(root, "package.json"))) {
      const cli = path.join(root, "bin", "knip.js");
      if (yield* fs.exists(cli)) return cli;
      return yield* new UnusedError({ message: `knip ships no bin/knip.js under ${root}` });
    }
    const parent = path.dirname(directory);
    directory = parent === directory ? undefined : parent;
  }
  return yield* new UnusedError({ message: "cannot resolve knip from the installed kit" });
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
  const run = yield* collect(process.execPath, [yield* knip()], root).pipe(
    Effect.mapError((cause) => new UnusedError({ message: `cannot run knip: ${cause.message}` })),
  );
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    return yield* new UnusedError({ message: `knip exits ${run.exitCode}: ${(run.stdout + run.stderr).trim()}` });
  }
  const scan: Scan = { tracked: tracked.length, files: filesOf(run.stdout).toSorted(), unmatched: unmatchedOf(`${run.stdout}
${run.stderr}`).toSorted() };
  yield* Console.log(report(scan));
  return scan.files.length === 0 && scan.unmatched.length === 0;
});

if (import.meta.main) runMain(NAME, unused);
