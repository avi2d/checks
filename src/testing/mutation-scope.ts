#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { escape, minimatch } from "minimatch";
import { changedPaths, git, pathsAt, pathsOf, rangeEnds, type Change } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { decodeBunfig, importedFile, importsOf, preloadPaths, readersOf, resolved, TEST_TREE } from "./mutation-scope-graph.ts";
import { balancedShards, MAX_SHARDS, mutantWeights, runnableMutants, type Shard } from "./mutation-shards.ts";

const NAME = "mutation-scope";
const USAGE = "usage: mutation-scope.ts <base> [full-baseline-report] | mutation-scope.ts --shards <count> [last-report]";
const SHARD_COUNT = /^[1-9]\d*$/;
const UNIT_TESTS = "tests/unit/";
const TEST_FILE = /\.test\.tsx?$/;
const READ_FILE = /\.tsx?$/;
const BUNFIG = "bunfig.toml";
const MUTATION_RANGE = /:\d+(?::\d+)?-\d+(?::\d+)?$/;

export const STRYKER_DEFAULT_MUTATE = [
  "{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)",
  "!{src,lib}/**/__tests__/**/*.+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)",
];

// Stryker loads the first of these that exists, in this order.
export const STRYKER_CONFIGS = ["", "."].flatMap((dot) =>
  [".conf", ".config"].flatMap((kind) => ["json", "js", "mjs", "cjs"].map((extension) => `${dot}stryker${kind}.${extension}`)),
);

export class ScopeError extends Schema.TaggedError<ScopeError>()("ScopeError", {
  message: Schema.String,
}) {}

const StrykerConfig = Schema.Struct({ mutate: Schema.optionalKey(Schema.Array(Schema.String)) });
const decodeJsonConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(StrykerConfig));
const decodeConfigModule = Schema.decodeUnknownEffect(Schema.Struct({ default: StrykerConfig }));

const BaselineSchema = Schema.Struct({
  files: Schema.Record(
    Schema.String,
    Schema.Struct({
      mutants: Schema.Array(
        Schema.Struct({
          coveredBy: Schema.optionalKey(Schema.Array(Schema.String)),
          killedBy: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
  testFiles: Schema.Record(
    Schema.String,
    Schema.Struct({ source: Schema.optionalKey(Schema.String), tests: Schema.Array(Schema.Struct({ id: Schema.String })) }),
  ),
});

export type Baseline = typeof BaselineSchema.Type;

const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(BaselineSchema));

const decodeMutantCounts = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(Schema.Struct({ static: Schema.optionalKey(Schema.Boolean), status: Schema.optionalKey(Schema.String) })) })),
    }),
  ),
);

export type MutationScope = { readonly scope: readonly string[]; readonly staleTests: readonly string[] };

export type Picked = {
  readonly scope: ReadonlySet<string>;
  readonly tests: ReadonlySet<string>;
  readonly touched: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
};

const isUnitTest = (path: string): boolean => path.startsWith(UNIT_TESTS) && TEST_FILE.test(path);

const absolute = (root: string, path: string): string => `/${resolved(path.startsWith("/") ? "" : root, path)}`;

// --mutate replaces the config's globs, so the scope applies the negated ones itself, resolving each against root as Stryker does.
export function mutatedBy(patterns: readonly string[], root: string): (file: string) => boolean {
  const rules = patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    return { glob: absolute(root, negated ? pattern.slice(1) : pattern), mutated: !negated };
  });
  return (file) => rules.reduce((mutated, rule) => (minimatch(absolute(root, file), rule.glob) ? rule.mutated : mutated), false);
}

function scopedNames(change: Change, mutated: (file: string) => boolean): readonly string[] {
  if (change.kind === "deleted") return [];
  if (change.kind === "renamed" && mutated(change.from) && mutated(change.path)) return [change.from, change.path];
  return mutated(change.path) ? [change.path] : [];
}

export function pickFromDiff(changes: readonly Change[], mutated: (file: string) => boolean): Picked {
  const paths = changes.flatMap(pathsOf);
  return {
    scope: new Set(changes.flatMap((change) => scopedNames(change, mutated))),
    tests: new Set(paths.filter(isUnitTest)),
    touched: new Set(paths.filter((path) => path.startsWith(TEST_TREE))),
    paths: new Set(paths),
  };
}

export { readersOf };

// Names what every unit test loads that the branch changes: the preload list, a preload, or a file a preload imports.
export function preloadChange(
  changed: ReadonlySet<string>,
  preloads: { readonly atBase: readonly string[]; readonly atHead: readonly string[] },
  loaded: ReadonlySet<string>,
): string | undefined {
  if (preloads.atBase.join("\n") !== preloads.atHead.join("\n")) return `the [test] preload list in ${BUNFIG}`;
  return [...preloads.atBase, ...loaded].find((path) => changed.has(path));
}

// Stryker leaves coveredBy empty on a static mutant, so only killedBy names its tests.
// A kill is lost only when every test that made it changed, so the one killer a run with bail records is enough.
export function coveringTests(baseline: Baseline, tests: ReadonlySet<string>, mutated: (file: string) => boolean): Map<string, readonly string[]> {
  const owners = new Map(Object.entries(baseline.testFiles).flatMap(([file, { tests: listed }]) => listed.map(({ id }) => [id, file] as const)));
  const covering = new Map<string, readonly string[]>();
  for (const [source, { mutants }] of Object.entries(baseline.files)) {
    if (!mutated(source)) continue;
    const owning = mutants.flatMap(({ coveredBy = [], killedBy = [] }) => [...coveredBy, ...killedBy].map((id) => owners.get(id) ?? ""));
    const changed = [...new Set(owning)].filter((file) => tests.has(file)).toSorted();
    if (changed.length > 0) covering.set(source, changed);
  }
  return covering;
}

// Stryker reads each --mutate entry as a glob whose backslashes are separators.
const mutateGlobs = (files: readonly string[]): string => files.map((file) => escape(file, { windowsPathsNoEscape: true, magicalBraces: true })).join(",");

// The incremental state keys each test by its literal path.
export function envLines({ scope, staleTests }: MutationScope): string {
  return [`SCOPE=${mutateGlobs(scope.toSorted())}`, `STALE_TESTS=${staleTests.toSorted().join(",")}`].join("\n");
}

export function shardsLine(shards: readonly Shard[]): string {
  return `SHARDS=${JSON.stringify(shards.map(({ files }) => mutateGlobs(files)))}`;
}

export type Options =
  | { readonly kind: "scope"; readonly base: string; readonly baseline: string | undefined }
  | { readonly kind: "shards"; readonly count: number; readonly report: string | undefined };

const isOperand = (arg: string | undefined): arg is string => arg !== undefined && !arg.startsWith("-");

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<Options, Usage> {
  const [first, second, third, ...extra] = argv;
  if (first === "--shards") {
    const count = Number(second);
    if (!SHARD_COUNT.test(second ?? "") || count > MAX_SHARDS || (third !== undefined && !isOperand(third)) || extra.length > 0) return yield* new Usage({ message: USAGE });
    return { kind: "shards", count, report: third };
  }
  if (!isOperand(first) || (second !== undefined && !isOperand(second)) || third !== undefined) return yield* new Usage({ message: USAGE });
  return { kind: "scope", base: first, baseline: second };
});

const loadConfig = Effect.fn("loadConfig")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const refused = (reason: string) => () => new ScopeError({ message: `${file} ${reason}` });
  if (file.endsWith(".json")) {
    return yield* fs.readFileString(file).pipe(Effect.flatMap(decodeJsonConfig), Effect.mapError(refused("is not a Stryker config whose mutate is a list of globs")));
  }
  const url = yield* path.toFileUrl(path.resolve(file)).pipe(Effect.mapError(refused("cannot be addressed")));
  const loaded = yield* Effect.tryPromise({
    try: (): Promise<unknown> => import(url.href),
    catch: (cause) => new ScopeError({ message: `cannot load ${file}: ${String(cause)}` }),
  });
  const { default: config } = yield* decodeConfigModule(loaded).pipe(Effect.mapError(refused("exports no Stryker config whose mutate is a list of globs")));
  return config;
});

const configuredMutate = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  for (const file of STRYKER_CONFIGS) {
    if (yield* fs.exists(file)) return (yield* loadConfig(file)).mutate ?? STRYKER_DEFAULT_MUTATE;
  }
  return STRYKER_DEFAULT_MUTATE;
});

const mutatePatterns = Effect.gen(function* () {
  const patterns = yield* configuredMutate;
  const ranged = patterns.filter((pattern) => MUTATION_RANGE.test(pattern));
  if (ranged.length > 0) {
    return yield* new ScopeError({ message: `the Stryker mutate entries ${ranged.join(" ")} name a mutation range, which a scope of whole files cannot keep` });
  }
  return patterns;
});

const preloadsAt = Effect.fn("preloadsAt")(function* (rev: string, paths: ReadonlySet<string>) {
  if (!paths.has(BUNFIG)) return [];
  const text = yield* git(["show", `${rev}:${BUNFIG}`]);
  const unparsed = () => new ScopeError({ message: `${BUNFIG} at ${rev} does not parse as TOML whose [test] preload is a path or a list of paths` });
  const bunfig = yield* Effect.try({ try: (): unknown => Bun.TOML.parse(text), catch: unparsed }).pipe(Effect.flatMap(decodeBunfig), Effect.mapError(unparsed));
  return preloadPaths(bunfig);
});

const transitivelyImported = Effect.fn("transitivelyImported")(function* (rev: string, roots: readonly string[], paths: ReadonlySet<string>) {
  const loaded = new Set<string>();
  for (let next = [...roots]; next.length > 0; ) {
    for (const file of next) loaded.add(file);
    const read = (file: string) =>
      git(["show", `${rev}:${file}`]).pipe(
        Effect.map((text) => importsOf(file, text, paths)),
        Effect.catchTag("GitFailure", (): Effect.Effect<readonly string[]> => Effect.succeed([])),
      );
    const imported = (yield* Effect.forEach(next, read, { concurrency: 16 })).flat();
    next = [...new Set(imported)].filter((file) => !loaded.has(file));
  }
  return loaded;
});

const loadedByPreloads = Effect.fn("loadedByPreloads")(function* (rev: string, preloads: readonly string[], paths: ReadonlySet<string>) {
  return yield* transitivelyImported(rev, preloads.flatMap((preload) => importedFile(preload, paths)), paths);
});

const readFiles = Effect.fn("readFiles")(function* (files: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const read = (file: string) => fs.readFileString(file).pipe(Effect.map((text) => [file, text] as const));
  return new Map(yield* Effect.forEach(files, read, { concurrency: 16 }));
});

const readTestTree = Effect.fn("readTestTree")(function* (paths: Iterable<string>) {
  return yield* readFiles([...paths].filter((path) => path.startsWith(TEST_TREE) && READ_FILE.test(path)));
});

const GRAPH_FILE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;

const readImportGraph = Effect.fn("readImportGraph")(function* (paths: Iterable<string>) {
  return yield* readFiles([...paths].filter((path) => GRAPH_FILE.test(path)));
});

const loadBaseline = Effect.fn("loadBaseline")(function* (report: string) {
  const unparsed = (cause: { readonly message: string }) => new ScopeError({ message: `${report} is not a Stryker mutation report with its test files: ${cause.message}` });
  return yield* (yield* FileSystem.FileSystem).readFileString(report).pipe(Effect.flatMap(decodeBaseline), Effect.mapError(unparsed));
});

type Snapshots = { readonly base: string; readonly head: string; readonly atBase: ReadonlySet<string>; readonly atHead: ReadonlySet<string> };

// Every unit test loads each preload, so a change to one makes every unit test read it.
const unitReaders = Effect.fn("unitReaders")(function* (picked: Picked, { base, head, atBase, atHead }: Snapshots) {
  const preloads = { atBase: yield* preloadsAt(base, atBase), atHead: yield* preloadsAt(head, atHead) };
  const everyTestReads = preloadChange(picked.paths, preloads, yield* loadedByPreloads(head, preloads.atHead, atHead));
  if (everyTestReads !== undefined) {
    yield* Console.error(`${NAME}: every unit test reads ${everyTestReads}`);
    return [...atHead].filter((test) => isUnitTest(test) && !picked.tests.has(test)).map((test) => [test, everyTestReads] as const);
  }
  if (picked.touched.size === 0) return [];
  const readers = [...readersOf(yield* readTestTree(atHead), [...picked.touched])].filter(([reader]) => isUnitTest(reader));
  for (const [reader, via] of readers) yield* Console.error(`${NAME}: ${reader} reads ${via}`);
  return readers;
});

export type Staleness = { readonly paths: ReadonlySet<string>; readonly preload: string | undefined; readonly stale: readonly string[]; readonly config: ReadonlySet<string> };

export const stalenessSince = Effect.fn("stalenessSince")(function* (base: string, head: string) {
  const picked = pickFromDiff(yield* changedPaths(base, head, []), () => false);
  const atBase = new Set(yield* pathsAt(base, []));
  const atHead = new Set(yield* pathsAt(head, []));
  const preloads = { atBase: yield* preloadsAt(base, atBase), atHead: yield* preloadsAt(head, atHead) };
  const loaded = new Set([...(yield* loadedByPreloads(head, preloads.atHead, atHead)), ...(yield* loadedByPreloads(base, preloads.atBase, atBase))]);
  const preload = preloadChange(picked.paths, preloads, loaded);
  const active = { atBase: STRYKER_CONFIGS.find((name) => atBase.has(name)), atHead: STRYKER_CONFIGS.find((name) => atHead.has(name)) };
  const config = new Set([
    ...(yield* transitivelyImported(head, active.atHead === undefined ? [] : [active.atHead], atHead)),
    ...(yield* transitivelyImported(base, active.atBase === undefined ? [] : [active.atBase], atBase)),
  ]);
  if (preload !== undefined) return { paths: picked.paths, preload, stale: [], config };
  if (picked.paths.size === 0) return { paths: picked.paths, preload: undefined, stale: [], config };
  const readers = [...readersOf(yield* readImportGraph(atHead), [...picked.paths])]
    .filter(([reader]) => isUnitTest(reader))
    .map(([reader]) => reader);
  const stale = [...new Set([...[...picked.paths].filter(isUnitTest), ...readers])].toSorted();
  return { paths: picked.paths, preload: undefined, stale, config };
});

// An absent coverage edge holds only for a test whose merge-base source is the one the report ran.
const staleIn = Effect.fn("staleIn")(function* (baseline: Baseline, tests: readonly string[], base: string) {
  const recorded = new Map(Object.entries(baseline.testFiles).map(([file, { source }]) => [file, source]));
  const atBase = yield* Effect.forEach(tests, (test) => git(["show", `${base}:${test}`]), { concurrency: 16 });
  return tests.filter((test, index) => recorded.get(test) !== atBase[index]).toSorted();
});

// Stryker reports no source without mutants, so a source the report lacks may be newer than it and enters.
const enteringSources = Effect.fn("enteringSources")(function* (
  report: string | undefined,
  tests: ReadonlySet<string>,
  mutated: (file: string) => boolean,
  { base, atBase, atHead }: Snapshots,
  scoped: ReadonlySet<string>,
) {
  if (tests.size === 0) return [];
  const eligible = (source: string): boolean => mutated(source) && !scoped.has(source) && atHead.has(source);
  const candidates = [...atHead].filter(eligible).toSorted();
  if (report === undefined || !(yield* (yield* FileSystem.FileSystem).exists(report))) {
    const where = report === undefined ? "" : ` at ${report}`;
    yield* Console.error(`::warning::${NAME}: ${[...tests].toSorted().join(",")} changed, but no full baseline report${where} says which sources they cover, so the scope holds no covered source. Refresh the full baseline with \`gh workflow run mutation -f mode=refresh\`.`);
    return [];
  }
  const baseline = yield* loadBaseline(report);
  const stale = yield* staleIn(baseline, [...tests].filter((test) => atBase.has(test)), base);
  if (stale.length > 0) {
    yield* Console.error(`${NAME}: the baseline report did not run ${stale.join(" ")} as the merge base holds it, so every mutated source enters`);
    return candidates;
  }
  const entering = [...coveringTests(baseline, tests, mutated)].filter(([source]) => eligible(source));
  for (const [source, via] of entering) yield* Console.error(`${NAME}: ${source} enters through ${via.join(" ")}`);
  const unknown = candidates.filter((source) => !Object.hasOwn(baseline.files, source));
  if (unknown.length > 0) yield* Console.error(`${NAME}: ${unknown.join(" ")} enter, as the baseline report holds no mutant of them`);
  return [...entering.map(([source]) => source), ...unknown];
});

const reportedCounts = Effect.fn("reportedCounts")(function* (report: string | undefined) {
  const fs = yield* FileSystem.FileSystem;
  if (report === undefined) {
    yield* Console.error(`${NAME}: no last report, so each file weighs one mutant`);
    return new Map<string, number>();
  }
  if (!(yield* fs.exists(report))) {
    return yield* new ScopeError({ message: `no last report at ${report}, so no shard can balance by mutant count` });
  }
  const unparsed = (cause: { readonly message: string }) => new ScopeError({ message: `${report} is not a Stryker mutation report: ${cause.message}` });
  const { files } = yield* fs.readFileString(report).pipe(Effect.flatMap(decodeMutantCounts), Effect.mapError(unparsed));
  return new Map(Object.entries(files).map(([file, { mutants }]) => [file, runnableMutants(mutants)]));
});

const pickShards = Effect.fn("pickShards")(function* (count: number, report: string | undefined) {
  const mutated = mutatedBy(yield* mutatePatterns, (yield* Path.Path).resolve("."));
  const files = (yield* pathsAt("HEAD", [])).filter(mutated);
  const shards = balancedShards(mutantWeights(files, yield* reportedCounts(report)), count);
  for (const [index, { files: held, mutants }] of shards.entries()) yield* Console.error(`${NAME}: shard ${index + 1} holds ${held.length} file(s) and about ${mutants} mutant(s)`);
  yield* Console.log(shardsLine(shards));
  return true;
});

const selectScope = Effect.gen(function* () {
  const options = yield* parseArgs(process.argv.slice(2));
  if (options.kind === "shards") return yield* pickShards(options.count, options.report);
  const { base, baseline } = options;
  const range = yield* rangeEnds(base, "HEAD");
  const mutated = mutatedBy(yield* mutatePatterns, (yield* Path.Path).resolve("."));
  const snapshots: Snapshots = { ...range, atBase: new Set(yield* pathsAt(range.base, [])), atHead: new Set(yield* pathsAt(range.head, [])) };
  const picked = pickFromDiff(yield* changedPaths(range.base, range.head, []), mutated);
  const readers = (yield* unitReaders(picked, snapshots)).map(([reader]) => reader);
  const tests = new Set([...picked.tests, ...readers]);
  const entering = yield* enteringSources(baseline, tests, mutated, snapshots, picked.scope);
  yield* Console.log(envLines({ scope: [...picked.scope, ...entering], staleTests: readers }));
  return true;
});

if (import.meta.main) runMain(NAME, selectScope);
