#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, checkoutFiles, collect, git, pathsAt, rangeFromArgs } from "./git.ts";
import { runMain } from "./main.ts";
import { readQuality } from "./quality-file.ts";

type Fragment = {
  readonly file: string;
  readonly start: number;
  readonly end: number;
};

type Clone = readonly [Fragment, Fragment];

type Rise = {
  readonly file: string;
  readonly before: number;
  readonly after: number;
  readonly clones: readonly Clone[];
};

type Held = {
  readonly measured: number;
  readonly rises: readonly Rise[];
  readonly advisory: ReadonlyMap<string, number>;
};

class JscpdUnreadable extends Schema.TaggedError<JscpdUnreadable>()("JscpdUnreadable", {
  message: Schema.String,
}) {}

const NAME = "repetition";
const USAGE = "usage: repetition.ts <ref> | <base-ref> <head-ref>";
const MIN_TOKENS = 50;
const MIN_LINES = 5;
const MEASURE = `at ${MIN_TOKENS} tokens and ${MIN_LINES} lines`;
const DECLARATIONS = ":(exclude,glob)**/*.d.ts";
const TYPESCRIPT = [":(glob)**/*.ts", ":(glob)**/*.tsx", DECLARATIONS];
const JSCPD_FINISHED = 0;
const REPORT = "jscpd-report.json";

const Location = Schema.Struct({ name: Schema.String, start: Schema.Int, end: Schema.Int });

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ duplicates: Schema.Array(Schema.Struct({ firstFile: Location, secondFile: Location })) })),
);

function fragmentOf({ name, start, end }: typeof Location.Type): Fragment {
  return { file: name, start, end };
}

export function repeatedLines(clones: readonly Clone[]): ReadonlyMap<string, number> {
  const lines = new Map<string, Set<number>>();
  for (const { file, start, end } of clones.flat()) {
    const covered = lines.get(file) ?? new Set<number>();
    for (let line = start; line <= end; line += 1) covered.add(line);
    lines.set(file, covered);
  }
  return new Map([...lines].map(([file, covered]) => [file, covered.size]));
}

// jscpd reads files from disk, and the working tree need not hold the revision: a merge checkout or an uncommitted edit.
const scan = Effect.fn("scan")(
  function* (root: string, rev: string, files: readonly string[]) {
    if (files.length === 0) return [];
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-repetition-" });
    const tree = yield* checkoutFiles(rev, files, scratch, root);
    const output = path.join(scratch, "report");
    const flags = ["--silent", "--no-tips", "--no-gitignore", "--reporters", "json", "--output", output];
    const thresholds = ["--min-tokens", `${MIN_TOKENS}`, "--min-lines", `${MIN_LINES}`];

    const run = yield* collect("jscpd", [...flags, ...thresholds, "."], tree).pipe(
      Effect.mapError((cause) => new JscpdUnreadable({ message: `cannot run jscpd: ${cause.message}` })),
    );
    if (run.exitCode !== JSCPD_FINISHED) {
      return yield* new JscpdUnreadable({ message: `jscpd exited ${run.exitCode}: ${run.stderr.trim() || run.stdout.trim()}` });
    }
    const { duplicates } = yield* fs.readFileString(path.join(output, REPORT)).pipe(
      Effect.flatMap(decodeReport),
      Effect.mapError((cause) => new JscpdUnreadable({ message: `cannot read jscpd's report: ${cause.message}` })),
    );
    return duplicates.map(({ firstFile, secondFile }): Clone => [fragmentOf(firstFile), fragmentOf(secondFile)]);
  },
  Effect.scoped,
);

function clonesOf(file: string, clones: readonly Clone[]): readonly Clone[] {
  return clones
    .flatMap(([first, second]): Clone[] => {
      if (first.file === file) return [[first, second]];
      return second.file === file ? [[second, first]] : [];
    })
    .toSorted(([a], [b]) => a.start - b.start);
}

const runHold = Effect.fn("runHold")(function* (root: string, production: readonly string[], base: string, head: string) {
  const pathspecs = [...production.map((glob) => `:(glob)${glob}`), DECLARATIONS];
  const held = yield* pathsAt(head, pathspecs, root);
  const holds = new Set(held);
  const others = (yield* pathsAt(head, TYPESCRIPT, root)).filter((file) => !holds.has(file));
  const formerPath = new Map(
    (yield* changedPaths(base, head, pathspecs, root)).flatMap((change) => (change.kind === "renamed" ? [[change.path, change.from]] : [])),
  );

  const before = repeatedLines(yield* scan(root, base, yield* pathsAt(base, pathspecs, root)));
  const clones = yield* scan(root, head, held);
  const after = repeatedLines(clones);
  const rises = held.flatMap((file): Rise[] => {
    const was = before.get(formerPath.get(file) ?? file) ?? 0;
    const is = after.get(file) ?? 0;
    return is > was ? [{ file, before: was, after: is, clones: clonesOf(file, clones) }] : [];
  });
  const risen = new Set(rises.map((rise) => rise.file));
  const advisory = [...after].filter(([file]) => !risen.has(file)).concat([...repeatedLines(yield* scan(root, head, others))]);
  return {
    measured: held.length,
    rises: rises.toSorted((a, b) => a.file.localeCompare(b.file)),
    advisory: new Map(advisory.toSorted(([a], [b]) => a.localeCompare(b))),
  } satisfies Held;
});

function describe({ file, before, after, clones }: Rise): readonly string[] {
  return [
    `  ${file}: ${after} repeated line(s), up from ${before}`,
    ...clones.map(([own, other]) => `    ${own.file}:${own.start}-${own.end} repeats ${other.file}:${other.start}-${other.end}`),
  ];
}

function report({ measured, rises, advisory }: Held): string {
  const verdict =
    rises.length === 0
      ? [`${NAME}: ${measured} production file(s) repeat no more lines than where the range starts, ${MEASURE}`]
      : [`${NAME}: ${rises.length} production file(s) repeat more lines than where the range starts, ${MEASURE}:`, ...rises.flatMap(describe)];
  const notice =
    advisory.size === 0
      ? []
      : [
          `${NAME}: advisory, ${advisory.size} file(s) repeat lines the hold does not fail:`,
          ...[...advisory].map(([file, lines]) => `  ${file}: ${lines} repeated line(s)`),
        ];
  return [...verdict, ...notice].join("\n");
}

const hold = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { base, head } = yield* rangeFromArgs(process.argv.slice(2), USAGE, root);
  const { source, quality } = yield* readQuality(root);
  const production = quality.sources?.production ?? [];
  if (production.length === 0) {
    yield* Console.log(`${NAME}: ${source} declares no sources.production`);
    return true;
  }
  const held = yield* runHold(root, production, base, head);

  yield* Console.log(report(held));
  return held.rises.length === 0;
});

if (import.meta.main) runMain(NAME, hold);
