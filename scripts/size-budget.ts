#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, collect, git, pathsAt, rangeEnds, type Change } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { readQuality, renderJson, type Quality } from "./quality-file.ts";

type Size = NonNullable<Quality["size"]>;

type Overrun = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

type Measured = {
  readonly scope: string;
  readonly held: readonly string[];
  readonly overruns: readonly Overrun[];
  readonly advisory: readonly Overrun[];
};

class OxlintUnreadable extends Schema.TaggedError<OxlintUnreadable>()("OxlintUnreadable", {
  message: Schema.String,
}) {}

const NAME = "size-budget";
const USAGE = "usage: size-budget.ts <ref> | <base-ref> <head-ref>";
const DECLARATIONS = ":(exclude,glob)**/*.d.ts";
const TYPESCRIPT = [":(glob)**/*.ts", ":(glob)**/*.tsx", DECLARATIONS];
const FILE_RULE = "eslint(max-lines)";
const FUNCTION_RULE = "eslint(max-lines-per-function)";
const OXLINT_FOUND_NOTHING = 0;
const OXLINT_FOUND_ERRORS = 1;

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      diagnostics: Schema.Array(
        Schema.Struct({
          code: Schema.String,
          message: Schema.String,
          filename: Schema.String,
          labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })),
        }),
      ),
    }),
  ),
);

function sizeConfig({ fileLines, functionLines }: Size): unknown {
  const counted = { skipBlankLines: false, skipComments: false };
  return {
    plugins: [],
    categories: { correctness: "off" },
    rules: {
      "max-lines": ["error", { max: fileLines, ...counted }],
      "max-lines-per-function": ["error", { max: functionLines, ...counted }],
    },
  };
}

function heldByChange(changes: readonly Change[]): readonly string[] {
  return changes.flatMap((change) => {
    if (change.kind === "written" || (change.kind === "renamed" && change.edited)) return [change.path];
    return [];
  });
}

const materialize = Effect.fn("materialize")(function* (root: string, head: string, files: readonly string[], tree: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const target = path.join(tree, file);
        yield* fs.makeDirectory(path.dirname(target), { recursive: true });
        yield* fs.writeFileString(target, yield* git(["cat-file", "blob", `${head}:${file}`], root));
      }),
    { concurrency: 8, discard: true },
  );
});

// oxlint reads files from disk, and the working tree need not hold the head: a merge checkout or an uncommitted edit.
const measure = Effect.fn("measure")(
  function* (root: string, head: string, size: Size, files: readonly string[]) {
    if (files.length === 0) return [];
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-size-budget-" });
    const tree = path.join(scratch, "tree");
    const config = path.join(scratch, "size.oxlintrc.json");
    yield* fs.writeFileString(config, renderJson(sizeConfig(size)));
    yield* materialize(root, head, files, tree);

    const args = ["-c", config, "-f", "json", ...files.map((file) => `./${file}`)];
    const { stdout, stderr, exitCode } = yield* collect("oxlint", args, tree).pipe(
      Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot run oxlint: ${cause.message}` })),
    );
    if (exitCode !== OXLINT_FOUND_NOTHING && exitCode !== OXLINT_FOUND_ERRORS) {
      return yield* new OxlintUnreadable({ message: `oxlint exited ${exitCode}: ${stderr.trim() || stdout.trim()}` });
    }
    const { diagnostics } = yield* decodeReport(stdout).pipe(
      Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot read oxlint's report: ${cause.message}` })),
    );
    return diagnostics.flatMap(({ code, message, filename, labels }): Overrun[] => {
      if (code === FILE_RULE) return [{ file: filename, line: undefined, message }];
      if (code === FUNCTION_RULE) return [{ file: filename, line: labels[0]?.span.line, message }];
      return [];
    });
  },
  Effect.scoped,
);

const runBudget = Effect.fn("runBudget")(function* (root: string, size: Size, production: readonly string[], base: string, head: string) {
  const pathspecs = [...production.map((glob) => `:(glob)${glob}`), DECLARATIONS];
  const held =
    size.applies === "all" ? yield* pathsAt(head, pathspecs, root) : heldByChange(yield* changedPaths(base, head, pathspecs, root));
  const holds = new Set(held);
  const others = (yield* pathsAt(head, TYPESCRIPT, root)).filter((file) => !holds.has(file));
  const overruns = (yield* measure(root, head, size, [...held, ...others])).toSorted(
    (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
  );
  return {
    scope: size.applies === "all" ? "every production file" : "the production files the range adds or changes",
    held,
    overruns: overruns.filter((overrun) => holds.has(overrun.file)),
    advisory: overruns.filter((overrun) => !holds.has(overrun.file)),
  } satisfies Measured;
});

function describe({ file, line, message }: Overrun): string {
  return `  ${file}${line === undefined ? "" : `:${line}`}: ${message}`;
}

function report({ scope, held, overruns, advisory }: Measured, { fileLines, functionLines }: Size): string {
  const budget = `${fileLines} lines per file and ${functionLines} per function`;
  const verdict =
    overruns.length === 0
      ? [`${NAME}: ${held.length} file(s), ${scope}, keep within ${budget}`]
      : [`${NAME}: ${overruns.length} overrun(s) of ${budget} in ${scope}:`, ...overruns.map(describe)];
  const notice =
    advisory.length === 0
      ? []
      : [`${NAME}: advisory, ${advisory.length} overrun(s) where the budget does not hold yet:`, ...advisory.map(describe)];
  return [...verdict, ...notice].join("\n");
}

const budget = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { source, quality } = yield* readQuality(root);
  if (quality.size === undefined) {
    yield* Console.log(`${NAME}: ${source} declares no size budget`);
    return true;
  }
  const { base, head } = yield* rangeEnds(first, second, root);
  const measured = yield* runBudget(root, quality.size, quality.sources?.production ?? [], base, head);

  yield* Console.log(report(measured, quality.size));
  return measured.overruns.length === 0;
});

if (import.meta.main) runMain(NAME, budget);
