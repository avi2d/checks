#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, checkoutFiles, collect, git, pathsAt, rangeFromArgs } from "./git.ts";
import { runMain } from "./main.ts";

export type Fragment = {
  readonly file: string;
  readonly start: number;
  readonly end: number;
};

export type Clone = readonly [Fragment, Fragment];

export type Rise = {
  readonly file: string;
  readonly before: number;
  readonly after: number;
  readonly clones: readonly Clone[];
};

export type Held = {
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
const CONFIG = ".jscpd.json";
const JSCPD_FINISHED = 0;
const REPORT = "jscpd-report.json";

const Location = Schema.Struct({ name: Schema.String, start: Schema.Int, end: Schema.Int });

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      duplicates: Schema.Array(Schema.Struct({ firstFile: Location, secondFile: Location })),
      statistics: Schema.Struct({ total: Schema.Struct({ sources: Schema.Int }) }),
    }),
  ),
);

type Scan = { readonly sources: number; readonly clones: readonly Clone[] };

function fragmentOf(file: (name: string) => string, { name, start, end }: typeof Location.Type): Fragment {
  return { file: file(name), start, end };
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
// Both ends scan under the head's config, so a changed file set never reads as a change in repetition.
const scan = Effect.fn("scan")(
  function* (root: string, rev: string, config: string) {
    const files = yield* pathsAt(rev, [], root);
    if (files.length === 0) return { sources: 0, clones: [] } satisfies Scan;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-repetition-" });
    const tree = yield* checkoutFiles(rev, files, scratch, root);
    yield* fs.writeFileString(path.join(tree, CONFIG), config);
    const output = path.join(scratch, "report");
    const flags = ["--silent", "--no-tips", "--no-gitignore", "--absolute", "--reporters", "json", "--output", output];
    const thresholds = ["--min-tokens", `${MIN_TOKENS}`, "--min-lines", `${MIN_LINES}`];

    const run = yield* collect("jscpd", [...flags, ...thresholds], tree).pipe(
      Effect.mapError((cause) => new JscpdUnreadable({ message: `cannot run jscpd: ${cause.message}` })),
    );
    const reportPath = path.join(output, REPORT);
    // A threshold, exitCode or failOnEmpty in the repository's config fails jscpd after the report is written.
    if (run.exitCode !== JSCPD_FINISHED && !(yield* fs.exists(reportPath))) {
      return yield* new JscpdUnreadable({ message: `jscpd exited ${run.exitCode}: ${run.stderr.trim() || run.stdout.trim()}` });
    }
    const { duplicates, statistics } = yield* fs.readFileString(reportPath).pipe(
      Effect.flatMap(decodeReport),
      Effect.mapError((cause) => new JscpdUnreadable({ message: `cannot read jscpd's report: ${cause.message}` })),
    );
    const scanned = yield* fs.realPath(tree);
    const file = (name: string): string => path.relative(scanned, name);
    const clones = duplicates.map(({ firstFile, secondFile }): Clone => [fragmentOf(file, firstFile), fragmentOf(file, secondFile)]);
    return { sources: statistics.total.sources, clones } satisfies Scan;
  },
  Effect.scoped,
);

export function clonesOf(file: string, clones: readonly Clone[]): readonly Clone[] {
  return clones
    .flatMap(([first, second]): Clone[] => {
      if (first.file === file) return [[first, second]];
      return second.file === file ? [[second, first]] : [];
    })
    .toSorted(([a], [b]) => a.start - b.start);
}

// Decides which held file repeats more lines than the same path, or the path it was renamed
// from, repeated at the base.
export function risesOf(
  held: readonly string[],
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  formerPath: ReadonlyMap<string, string>,
  clones: readonly Clone[],
): readonly Rise[] {
  return held
    .flatMap((file): Rise[] => {
      const was = before.get(formerPath.get(file) ?? file) ?? 0;
      const is = after.get(file) ?? 0;
      return is > was ? [{ file, before: was, after: is, clones: clonesOf(file, clones) }] : [];
    })
    .toSorted((a, b) => a.file.localeCompare(b.file));
}

// Tallies every repeating file that did not rise as advisory.
export function heldOf(measured: number, rises: readonly Rise[], after: ReadonlyMap<string, number>): Held {
  const risen = new Set(rises.map((rise) => rise.file));
  const advisory = [...after].filter(([file]) => !risen.has(file));
  return { measured, rises, advisory: new Map(advisory.toSorted(([a], [b]) => a.localeCompare(b))) };
}

const runHold = Effect.fn("runHold")(function* (root: string, config: string, base: string, head: string) {
  const formerPath = new Map(
    (yield* changedPaths(base, head, [], root)).flatMap((change) => (change.kind === "renamed" ? [[change.path, change.from]] : [])),
  );
  const before = repeatedLines((yield* scan(root, base, config)).clones);
  const { sources, clones } = yield* scan(root, head, config);
  const after = repeatedLines(clones);
  const rises = risesOf([...after.keys()], before, after, formerPath, clones);
  return heldOf(sources, rises, after) satisfies Held;
});

export function describe({ file, before, after, clones }: Rise): readonly string[] {
  return [
    `  ${file}: ${after} repeated line(s), up from ${before}`,
    ...clones.map(([own, other]) => `    ${own.file}:${own.start}-${own.end} repeats ${other.file}:${other.start}-${other.end}`),
  ];
}

export function report({ measured, rises, advisory }: Held): string {
  const verdict =
    rises.length === 0
      ? [`${NAME}: ${measured} file(s) ${CONFIG} holds repeat no more lines than where the range starts, ${MEASURE}`]
      : [`${NAME}: ${rises.length} file(s) ${CONFIG} holds repeat more lines than where the range starts, ${MEASURE}:`, ...rises.flatMap(describe)];
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
  if ((yield* pathsAt(head, [`:(literal)${CONFIG}`], root)).length === 0) {
    yield* Console.log(`${NAME}: the head holds no ${CONFIG}, so no file is measured`);
    return true;
  }
  const held = yield* runHold(root, yield* git(["show", `${head}:${CONFIG}`], root), base, head);

  yield* Console.log(report(held));
  return held.rises.length === 0;
});

if (import.meta.main) runMain(NAME, hold);
