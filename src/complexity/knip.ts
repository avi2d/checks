import { Console, Effect, FileSystem, Path, Schema } from "effect";
import type { TrackedContent } from "../core/gates.ts";
import { collect, git } from "../core/git.ts";

class KnipError extends Schema.TaggedError<KnipError>()("KnipError", {
  message: Schema.String,
}) {}

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

const hasKnipConfig = Effect.fn("hasKnipConfig")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of CONFIGS) {
    if (yield* fs.exists(path.join(root, name))) return true;
  }
  const manifest: unknown = yield* fs.readFileString(path.join(root, "package.json")).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: () => new KnipError({ message: "package.json does not parse as JSON" }),
      })
    ),
  );
  return typeof manifest === "object" && manifest !== null && "knip" in manifest;
});

const knipBinary = Effect.fn("knipBinary")(function* () {
  const path = yield* Path.Path;
  const main = yield* Effect.try({
    try: () => new URL("../bin/knip.js", import.meta.resolve("knip")),
    catch: () => new KnipError({ message: "cannot resolve knip from the installed kit" }),
  });
  return yield* path.fromFileUrl(main);
});

export const knipReport = Effect.fn("knipReport")(function* (root: string, args: readonly string[]) {
  if (!(yield* hasKnipConfig(root))) return { kind: "unconfigured" } as const;
  const run = yield* collect(process.execPath, [yield* knipBinary(), ...args, "--reporter", "json"], root).pipe(
    Effect.mapError((cause) => new KnipError({ message: `cannot run knip: ${cause.message}` })),
  );
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    return yield* new KnipError({ message: `knip exits ${run.exitCode}: ${(run.stdout + run.stderr).trim()}` });
  }
  return { kind: "reported", stdout: run.stdout } as const;
});

export const scanTree = Effect.fn("scanTree")(function* (name: string, args: readonly string[], source: TrackedContent) {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const tracked = (yield* git(["ls-files", "--", ...source.pathspecs], root))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (tracked.length === 0) return yield* new KnipError({ message: `no tracked ${source.content} to scan` });
  const reported = yield* knipReport(root, args);
  if (reported.kind === "unconfigured") {
    yield* Console.log(`${name}: no knip configuration names entry files, so add a knip.config.ts calling defineConfig from @avi2dg/checks/knip`);
  }
  return { root, tracked: tracked.length, reported };
});
