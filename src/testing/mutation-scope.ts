#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { minimatch } from "minimatch";
import { changedPaths, pathsAt, rangeEnds, type Change } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const NAME = "mutation-scope";
const USAGE = "usage: mutation-scope.ts <base> [full-baseline-report]";
const TEST_TREE = "tests/";
const UNIT_TESTS = "tests/unit/";
const FIXTURES = "tests/fixtures/";
const TEST_FILE = /\.test\.tsx?$/;
const READ_FILE = /\.tsx?$/;
const BUNFIG = "bunfig.toml";

export const STRYKER_DEFAULT_MUTATE = [
  "{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)",
  "!{src,lib}/**/__tests__/**/*.+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)",
];

// Stryker loads the first of these that exists, in this order.
const STRYKER_CONFIGS = ["", "."].flatMap((dot) =>
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
  testFiles: Schema.Record(Schema.String, Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) })),
});

export type Baseline = typeof BaselineSchema.Type;

const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(BaselineSchema));

const decodeBunfig = Schema.decodeUnknownEffect(
  Schema.Struct({
    test: Schema.optionalKey(Schema.Struct({ preload: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])) })),
  }),
);

export type MutationScope = {
  readonly scope: readonly string[];
  readonly added: readonly string[];
  readonly renamed: readonly string[];
  readonly tests: readonly string[];
  readonly staleTests: readonly string[];
};

export type Picked = {
  readonly scope: ReadonlySet<string>;
  readonly added: ReadonlySet<string>;
  readonly renamed: readonly string[];
  readonly tests: ReadonlySet<string>;
  readonly touched: ReadonlySet<string>;
};

const isUnitTest = (path: string): boolean => path.startsWith(UNIT_TESTS) && TEST_FILE.test(path);

// --mutate replaces the config's globs, so the scope applies the negated ones itself.
export function mutatedBy(patterns: readonly string[]): (file: string) => boolean {
  const rules = patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    return { glob: (negated ? pattern.slice(1) : pattern).replace(/^\.\//, ""), mutated: !negated };
  });
  return (file) => rules.reduce((mutated, rule) => (minimatch(file, rule.glob) ? rule.mutated : mutated), false);
}

type SourcePick = { readonly scoped: readonly string[]; readonly added: readonly string[]; readonly renamed: readonly string[] };

const UNPICKED: SourcePick = { scoped: [], added: [], renamed: [] };

function sourcePick(change: Change, mutated: (file: string) => boolean, atBase: ReadonlySet<string>): SourcePick {
  if (change.kind === "deleted") return UNPICKED;
  if (change.kind === "renamed" && mutated(change.from) && mutated(change.path)) {
    return { scoped: [change.from, change.path], added: [], renamed: [`${change.from}:${change.path}`] };
  }
  if (!mutated(change.path)) return UNPICKED;
  const fresh = change.kind === "renamed" || !atBase.has(change.path);
  return { scoped: [change.path], added: fresh ? [change.path] : [], renamed: [] };
}

const pathsOf = (change: Change): readonly string[] => (change.kind === "renamed" ? [change.from, change.path] : [change.path]);

export function pickFromDiff(changes: readonly Change[], mutated: (file: string) => boolean, atBase: ReadonlySet<string>): Picked {
  const picks = changes.map((change) => sourcePick(change, mutated, atBase));
  const paths = changes.flatMap(pathsOf);
  return {
    scope: new Set(picks.flatMap(({ scoped }) => scoped)),
    added: new Set(picks.flatMap(({ added }) => added)),
    renamed: picks.flatMap(({ renamed }) => renamed),
    tests: new Set(paths.filter(isUnitTest)),
    touched: new Set(paths.filter((path) => path.startsWith(TEST_TREE))),
  };
}

const IMPORT = /(?:from|import)[ \t]*\(?[ \t]*["'](\.[^"']*)["']/g;
const LISTED_SEGMENTS = /["'`][ \t]*,[ \t]*["'`]/g;
const DIRECTORY_ENDS = ['"', "'", "`", '/"', "/'", "/`", "/${"];

type Needle = { readonly text: string; readonly kind: "file" | "directory"; readonly fixture: string };

function resolved(directory: string, spec: string): string {
  const parts: string[] = [];
  for (const part of `${directory}/${spec}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

const moduleOf = (path: string): string => path.replace(/\.(?:ts|tsx|mts|js|mjs)$/, "").replace(/\/index$/, "");

function fixtureNeedles(changed: readonly string[]): readonly Needle[] {
  const needles = new Map<string, Needle>();
  for (const fixture of changed.filter((path) => path.startsWith(FIXTURES))) {
    const text = fixture.slice(TEST_TREE.length);
    needles.set(text, { text, kind: "file", fixture });
    for (let end = text.lastIndexOf("/"); end > 0; end = text.lastIndexOf("/", end - 1)) {
      const directory = text.slice(0, end);
      if (!needles.has(directory)) needles.set(directory, { text: directory, kind: "directory", fixture });
    }
  }
  return [...needles.values()];
}

function mentions(line: string, { text, kind }: Needle): boolean {
  if (kind === "file") return line.includes(text);
  return DIRECTORY_ENDS.some((end) => line.includes(text + end));
}

type Edge = { readonly importer: string; readonly imported: string };

function edgesOf(file: string, text: string, preloaded: readonly string[]): readonly Edge[] {
  const directory = file.slice(0, file.lastIndexOf("/"));
  const imported = [...text.matchAll(IMPORT)].map(([, spec = ""]) => moduleOf(resolved(directory, spec)));
  return (TEST_FILE.test(file) ? [...preloaded, ...imported] : imported).map((module) => ({ importer: file, imported: module }));
}

function fixtureNamedIn(text: string, needles: readonly Needle[]): string | undefined {
  if (needles.length === 0) return undefined;
  for (const line of text.split("\n")) {
    const joined = line.replaceAll(LISTED_SEGMENTS, "/");
    const needle = needles.find((each) => mentions(joined, each));
    if (needle !== undefined) return needle.fixture;
  }
  return undefined;
}

function spread(reached: Map<string, string>, edges: readonly Edge[]): void {
  const reachedModules = new Map([...reached].map(([file, via]) => [moduleOf(file), via]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const { importer, imported } of edges) {
      const via = reachedModules.get(imported);
      if (via === undefined || reached.has(importer)) continue;
      reached.set(importer, via);
      reachedModules.set(moduleOf(importer), via);
      grew = true;
    }
  }
}

// Maps each file that reads a changed path, through an import, a bunfig preload or the fixture's path, to that changed path.
export function readersOf(sources: ReadonlyMap<string, string>, changed: readonly string[], preloads: readonly string[]): Map<string, string> {
  const reached = new Map(changed.map((path) => [path, path]));
  const needles = fixtureNeedles(changed);
  for (const [file, text] of sources) {
    const fixture = reached.has(file) ? undefined : fixtureNamedIn(text, needles);
    if (fixture !== undefined) reached.set(file, fixture);
  }
  const preloaded = preloads.map((preload) => moduleOf(resolved("", preload)));
  spread(reached, [...sources].flatMap(([file, text]) => edgesOf(file, text, preloaded)));
  return new Map([...reached].filter(([file, via]) => file !== via));
}

// Stryker leaves coveredBy empty on a static mutant, so only killedBy names its tests, and all of them only from a run without bail.
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

export function envLines({ scope, added, renamed, tests, staleTests }: MutationScope): string {
  const line = (name: string, values: readonly string[]): string => `${name}=${values.toSorted().join(",")}`;
  return [line("SCOPE", scope), line("ADDED", added), line("RENAMED", renamed), line("TESTS", tests), line("STALE_TESTS", staleTests)].join("\n");
}

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<{ readonly base: string; readonly baseline: string | undefined }, Usage> {
  const [base, baseline, ...extra] = argv;
  if (base === undefined || base.startsWith("-") || baseline?.startsWith("-") === true || extra.length > 0) return yield* new Usage({ message: USAGE });
  return { base, baseline };
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

const mutatePatterns = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  for (const file of STRYKER_CONFIGS) {
    if (yield* fs.exists(file)) return (yield* loadConfig(file)).mutate ?? STRYKER_DEFAULT_MUTATE;
  }
  return STRYKER_DEFAULT_MUTATE;
});

const bunPreloads = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(BUNFIG))) return [];
  const text = yield* fs.readFileString(BUNFIG);
  const unparsed = () => new ScopeError({ message: `${BUNFIG} does not parse as TOML whose [test] preload is a path or a list of paths` });
  const bunfig = yield* Effect.try({ try: (): unknown => Bun.TOML.parse(text), catch: unparsed }).pipe(Effect.flatMap(decodeBunfig), Effect.mapError(unparsed));
  const preload = bunfig.test?.preload ?? [];
  return typeof preload === "string" ? [preload] : preload;
});

const readTestTree = Effect.fn("readTestTree")(function* (paths: Iterable<string>) {
  const fs = yield* FileSystem.FileSystem;
  const files = [...paths].filter((path) => path.startsWith(TEST_TREE) && READ_FILE.test(path));
  const read = (file: string) => fs.readFileString(file).pipe(Effect.map((text) => [file, text] as const));
  return new Map(yield* Effect.forEach(files, read, { concurrency: 16 }));
});

const loadBaseline = Effect.fn("loadBaseline")(function* (report: string | undefined, tests: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem;
  if (report === undefined || !(yield* fs.exists(report))) {
    const where = report === undefined ? "" : ` at ${report}`;
    return yield* new ScopeError({ message: `${[...tests].toSorted().join(",")} changed, but no baseline report${where} says which sources they cover` });
  }
  const unparsed = (cause: { readonly message: string }) => new ScopeError({ message: `${report} is not a Stryker mutation report with its test files: ${cause.message}` });
  return yield* fs.readFileString(report).pipe(Effect.flatMap(decodeBaseline), Effect.mapError(unparsed));
});

const unitReaders = Effect.fn("unitReaders")(function* (touched: ReadonlySet<string>, atHead: ReadonlySet<string>) {
  if (touched.size === 0) return [];
  const readers = readersOf(yield* readTestTree(atHead), [...touched], yield* bunPreloads);
  return [...readers].filter(([reader]) => isUnitTest(reader)).toSorted(([a], [b]) => (a < b ? -1 : 1));
});

const enteringSources = Effect.fn("enteringSources")(function* (report: string | undefined, tests: ReadonlySet<string>, mutated: (file: string) => boolean, eligible: (source: string) => boolean) {
  if (tests.size === 0) return [];
  const entering = [...coveringTests(yield* loadBaseline(report, tests), tests, mutated)].filter(([source]) => eligible(source));
  for (const [source, via] of entering) yield* Console.error(`${NAME}: ${source} enters through ${via.join(" ")}`);
  return entering.map(([source]) => source);
});

const selectScope = Effect.gen(function* () {
  const { base, baseline } = yield* parseArgs(process.argv.slice(2));
  const range = yield* rangeEnds(base, "HEAD");
  const mutated = mutatedBy(yield* mutatePatterns);
  const atHead = new Set(yield* pathsAt(range.head, []));
  const picked = pickFromDiff(yield* changedPaths(range.base, range.head, []), mutated, new Set(yield* pathsAt(range.base, [])));
  const readers = yield* unitReaders(picked.touched, atHead);
  const tests = new Set(picked.tests);
  for (const [reader, via] of readers.filter(([file]) => !picked.tests.has(file))) {
    tests.add(reader);
    yield* Console.error(`${NAME}: ${reader} reads ${via}`);
  }
  const entering = yield* enteringSources(baseline, tests, mutated, (source) => !picked.scope.has(source) && atHead.has(source));
  yield* Console.log(
    envLines({ scope: [...picked.scope, ...entering], added: [...picked.added], renamed: picked.renamed, tests: [...tests], staleTests: readers.map(([reader]) => reader) }),
  );
  return true;
});

if (import.meta.main) runMain(NAME, selectScope);
