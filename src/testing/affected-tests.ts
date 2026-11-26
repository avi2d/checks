import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { addReachTests, readReachChange, refuseReachMap, type ReachChange } from "../core/reach-change.ts";
import { basenameOf, pullRequestReason, testEnvironmentReason, TEST_FILE, TEST_FIXTURES } from "../core/test-impact.ts";
import type { TestTier } from "../core/test-script.ts";
import { decodeSetting, loadSettings, Reach, SETTINGS_FILE } from "../core/settings.ts";
import { importedFile, importsOf, resolved, TEST_TREE } from "../core/imports.ts";
import { decodeBunfig, preloadPaths } from "./mutation-scope-graph.ts";
import { helperImpact, reportImpact } from "./helper-impact.ts";

export type Narrowing =
  | { readonly kind: "full"; readonly because: string }
  | { readonly kind: "files"; readonly files: readonly string[] };

type SharedChange = { readonly path: string; readonly reason: string };

export type LocalNarrowing =
  | { readonly kind: "full"; readonly because: string }
  | { readonly kind: "files"; readonly files: readonly string[]; readonly shared: readonly SharedChange[] };

type SelfReference = {
  readonly name: string;
  readonly exports: ReadonlyMap<string, string>;
};

type ReachRule = { readonly changed: string; readonly tests: readonly string[] };

export type Repository = {
  readonly files: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly bins: ReadonlyMap<string, string>;
  readonly self: SelfReference | undefined;
  readonly preloads: readonly string[];
  readonly reach: readonly ReachRule[];
  readonly packageImports?: ReadonlyMap<string, readonly string[]>;
};

const REACH = `${SETTINGS_FILE} reach`;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|astro|svelte|vue|sh)$/;
const STYLESHEET = /\.(?:css|scss|sass|less|pcss|styl)$/;
const FONT = /\.(?:woff2?|ttf|otf|eot)$/;
const LAYOUT = /^layout\./i;
const LISTED_SEGMENTS = /["'`][ \t]*,[ \t]*["'`]/g;
const TOKEN = /[\w.@/-]+/g;
const LEADING_HOPS = /^(?:\.{1,2}\/|\/)+/;
const BARE_IMPORT = /(?:from|import)\s*\(?\s*["']([^"'.][^"']*)["']|require\s*\(\s*["']([^"'.][^"']*)["']\s*\)/g;
// Bun picks the first condition it knows, and types names no file it runs.
const CONDITIONS = ["bun", "import", "default", "node", "require"];
const BUILT = "the build";

const directoryNode = (directory: string): string => directory + "/";

function runnerReason(path: string, preloads: ReadonlySet<string>): string | undefined {
  if (preloads.has(path)) return "a file Bun preloads into every test";
  return path.startsWith(".github/") ? undefined : testEnvironmentReason(path);
}

function renderedReason(path: string): string | undefined {
  const name = basenameOf(path);
  const directories = path.split("/").slice(0, -1);
  if (STYLESHEET.test(name)) return "a stylesheet";
  if (FONT.test(name) || directories.includes("fonts")) return "a font";
  if (directories.includes("layouts") || LAYOUT.test(name)) return "a layout";
  return undefined;
}

export function sharedReason(path: string, preloads: ReadonlySet<string>): string | undefined {
  if (path.startsWith(TEST_FIXTURES)) return undefined;
  return runnerReason(path, preloads) ?? renderedReason(path);
}

const globMatches = (pattern: string, path: string): boolean => new Bun.Glob(pattern).match(path);

function testFilesOf(repository: Repository): readonly string[] {
  return repository.files.filter((file) => TEST_FILE.test(file));
}

// Undefined when no rule names the path, so the path keeps the shared-file rule.
function mappedTests(path: string, repository: Repository): readonly string[] | undefined {
  const rules = repository.reach.filter((rule) => globMatches(rule.changed, path));
  if (rules.length === 0) return undefined;
  const patterns = rules.flatMap((rule) => rule.tests);
  return testFilesOf(repository).filter((file) => patterns.some((pattern) => globMatches(pattern, file)));
}

// A test pattern that matches no test file would silently drop the tests a renamed file used to name.
export function staleReachPatterns(repository: Repository): readonly { readonly changed: string; readonly pattern: string }[] {
  const tests = testFilesOf(repository);
  return repository.reach.flatMap((rule) =>
    rule.tests
      .filter((pattern) => !tests.some((file) => globMatches(pattern, file)))
      .map((pattern) => ({ changed: rule.changed, pattern })));
}

// A path mentioned by any trailing run of two or more of its segments, or in full, names it.
function mentionKeys(path: string): readonly string[] {
  const segments = path.split("/");
  const keys = [path];
  for (let start = 1; start <= segments.length - 2; start += 1) keys.push(segments.slice(start).join("/"));
  return keys;
}

// Only a fixture is read by its directory; a source directory a file names is one it lists, as a runner does.
function directoriesOf(path: string): readonly string[] {
  if (!path.startsWith(TEST_FIXTURES)) return [];
  const segments = path.split("/");
  return segments.slice(1).map((_, end) => segments.slice(0, end + 1).join("/"));
}

function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (typeof target !== "object" || target === null) return undefined;
  const conditions: Readonly<Record<string, unknown>> = { ...target };
  for (const condition of CONDITIONS) {
    const found = exportTarget(conditions[condition]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function exportsMap(exports: unknown): ReadonlyMap<string, string> {
  if (typeof exports === "string") return new Map([[".", resolved("", exports)]]);
  if (typeof exports !== "object" || exports === null) return new Map();
  const entries: Readonly<Record<string, unknown>> = { ...exports };
  return new Map(Object.entries(entries).flatMap(([key, target]) => {
    const file = exportTarget(target);
    return file === undefined ? [] : [[key, resolved("", file)] as const];
  }));
}

function selfTarget(spec: string, self: SelfReference): string | undefined {
  if (spec !== self.name && !spec.startsWith(self.name + "/")) return undefined;
  const subpath = spec === self.name ? "." : "./" + spec.slice(self.name.length + 1);
  if (self.exports.size === 0) return resolved("", subpath === "." ? "index" : subpath);
  const exact = self.exports.get(subpath);
  if (exact !== undefined) return exact;
  for (const [key, target] of self.exports) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const [before, after] = [key.slice(0, star), key.slice(star + 1)];
    if (subpath.startsWith(before) && subpath.endsWith(after) && subpath.length >= key.length - 1) {
      return target.replace("*", subpath.slice(before.length, subpath.length - after.length));
    }
  }
  return BUILT;
}

type Graph = { readonly readers: ReadonlyMap<string, ReadonlySet<string>>; readonly builtReaders: ReadonlySet<string> };

function linkTo(readers: Map<string, Set<string>>, read: string, reader: string): void {
  if (read === reader) return;
  readers.set(read, (readers.get(read) ?? new Set()).add(reader));
}

function bareSpecifiers(text: string): readonly string[] {
  return Array.from(text.matchAll(BARE_IMPORT), ([, viaImport = "", viaRequire = ""]) => viaImport || viaRequire);
}

function bareImports(file: string, text: string, repository: Repository, known: ReadonlySet<string>): readonly string[] {
  const self = repository.self;
  const ownImports = self === undefined ? [] : bareSpecifiers(text).flatMap((specifier) => {
    const own = selfTarget(specifier, self);
    if (own === undefined) return [];
    const found = importedFile(own, known);
    return found.length === 0 ? [BUILT] : found;
  });
  return [...ownImports, ...(repository.packageImports?.get(file) ?? [])];
}

function mentioned(text: string, index: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const joined = text.replaceAll(LISTED_SEGMENTS, "/");
  return [...joined.matchAll(TOKEN)].flatMap(([token]) => index.get(token.replace(LEADING_HOPS, "").replace(/\/$/, "")) ?? []);
}

function mentionIndex(repository: Repository, known: ReadonlySet<string>): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  const add = (key: string, node: string) => index.set(key, [...(index.get(key) ?? []), node]);
  const directories = new Set([...known].flatMap(directoriesOf));
  for (const file of known) for (const key of mentionKeys(file)) add(key, file);
  for (const directory of directories) for (const key of mentionKeys(directory)) if (key.includes("/")) add(key, directoryNode(directory));
  for (const [bin, file] of repository.bins) add(bin, file);
  return index;
}

function graphOf(repository: Repository, changed: readonly string[]): Graph {
  const known = new Set([...repository.files, ...changed]);
  const index = mentionIndex(repository, known);
  const readers = new Map<string, Set<string>>();
  const builtReaders = new Set<string>();
  for (const [file, text] of repository.sources) {
    const bare = bareImports(file, text, repository, known);
    if (bare.includes(BUILT)) builtReaders.add(file);
    const named = file.startsWith(TEST_TREE) ? mentioned(text, index) : [];
    for (const read of [...importsOf(file, text, known), ...bare.filter((target) => target !== BUILT), ...named]) {
      linkTo(readers, read, file);
    }
  }
  return { readers, builtReaders };
}

function reach(graph: Graph, changed: readonly string[], sources: ReadonlyMap<string, string>): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [...changed];
  const builds = changed.some((path) => sources.has(path) && !path.startsWith(TEST_TREE));
  if (builds) pending.push(...graph.builtReaders);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (reached.has(node)) continue;
    reached.add(node);
    pending.push(...(graph.readers.get(node) ?? []));
    if (!node.endsWith("/")) pending.push(...directoriesOf(node).map(directoryNode));
  }
  return reached;
}

function preloadClosure(repository: Repository): ReadonlySet<string> {
  const known = new Set(repository.files);
  const loaded = new Set<string>();
  for (let pending = [...repository.preloads]; pending.length > 0; ) {
    const file = pending.pop() ?? "";
    if (loaded.has(file)) continue;
    loaded.add(file);
    const text = repository.sources.get(file) ?? "";
    pending.push(...importsOf(file, text, known), ...bareImports(file, text, repository, known).filter((read) => read !== BUILT));
  }
  return loaded;
}

function reachMapProblem(repository: Repository): string | undefined {
  const stale = staleReachPatterns(repository);
  if (stale.length === 0) return undefined;
  return `${REACH} names ${stale.map((entry) => `${entry.pattern} for ${entry.changed}`).join(", ")}, which matches no test file`;
}

function fullRunReason(changed: readonly string[], repository: Repository, tier?: TestTier): string | undefined {
  if (changed.length === 0) return "the pull request changes no file";
  for (const path of changed) {
    const reason = tier === "pixel" && path.startsWith(".github/") ? testEnvironmentReason(path) : undefined;
    if (reason !== undefined) return pullRequestReason(path, reason);
  }
  const shared = sharedChanges(changed, repository).find(({ reason }) => tier !== "pixel" || reason !== "a test helper");
  if (shared !== undefined) return pullRequestReason(shared.path, shared.reason);
  if (tier === "pixel") {
    const unmappedSitePath = changed.find((path) => !path.startsWith(TEST_TREE) && mappedTests(path, repository) === undefined);
    if (unmappedSitePath !== undefined) return pullRequestReason(unmappedSitePath, "a path with no screenshot test mapping");
  }
  return reachMapProblem(repository);
}

type TestImpact =
  | Extract<Narrowing, { kind: "full" }>
  | { readonly kind: "files"; readonly byChange: ReadonlyMap<string, readonly string[]> };

function testImpact(changed: readonly string[], repository: Repository, tests: readonly string[], tier?: TestTier): TestImpact {
  const because = fullRunReason(changed, repository, tier);
  if (because !== undefined) return { kind: "full", because };
  const graph = graphOf(repository, changed);
  return { kind: "files", byChange: new Map(changed.map((path) => [path, testsReachedBy([path], graph, repository, tests)])) };
}

function selectedTests(impact: TestImpact, tests: readonly string[]): Narrowing {
  if (impact.kind === "full") return impact;
  const reached = new Set([...impact.byChange.values()].flat());
  return { kind: "files", files: tests.filter((test) => reached.has(test)) };
}

export function narrowTests(changed: readonly string[], repository: Repository, tests: readonly string[]): Narrowing {
  return selectedTests(testImpact(changed, repository, tests), tests);
}

export function narrowLocalTests(changed: readonly string[], repository: Repository, tests: readonly string[]): LocalNarrowing {
  const problem = reachMapProblem(repository);
  if (problem !== undefined) return { kind: "full", because: problem };
  return { kind: "files", files: testsReachedBy(changed, graphOf(repository, changed), repository, tests), shared: sharedChanges(changed, repository) };
}

function sharedChanges(changed: readonly string[], repository: Repository): readonly SharedChange[] {
  const preloads = preloadClosure(repository);
  return changed.flatMap((path) => {
    if (path.startsWith(TEST_FIXTURES)) return [];
    const reason = mappedTests(path, repository) === undefined ? sharedReason(path, preloads) : runnerReason(path, preloads);
    return reason === undefined ? [] : [{ path, reason }];
  });
}

function testsReachedBy(changed: readonly string[], graph: Graph, repository: Repository, tests: readonly string[]): readonly string[] {
  const reached = reach(graph, changed, repository.sources);
  const mapped = new Set(changed.flatMap((path) => mappedTests(path, repository) ?? []));
  return tests.filter((test) => reached.has(test) || mapped.has(test));
}

const Manifest = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(Schema.Unknown),
  bin: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
});
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

class NarrowingError extends Schema.TaggedError<NarrowingError>()("NarrowingError", {
  message: Schema.String,
}) {}

class ReachMapError extends Schema.TaggedError<ReachMapError>()("ReachMapError", {
  message: Schema.String,
}) {}

function binsOf(manifest: typeof Manifest.Type): ReadonlyMap<string, string> {
  const { bin, name } = manifest;
  if (bin === undefined) return new Map();
  if (typeof bin === "string") return name === undefined ? new Map() : new Map([[basenameOf(name), resolved("", bin)]]);
  return new Map(Object.entries(bin).map(([command, file]) => [command, resolved("", file)]));
}

const readPackageImports = Effect.fn("readPackageImports")(function* (root: string, repository: Repository) {
  const path = yield* Path.Path;
  const known = new Set(repository.files);
  const resolve = (specifier: string, directory: string) => Effect.tryPromise({
    try: () => Bun.resolve(specifier, directory),
    catch: () => new NarrowingError({ message: `could not resolve ${specifier} from ${directory}` }),
  }).pipe(
    Effect.map((file) => path.relative(root, file)),
    Effect.catchTag("NarrowingError", () => Effect.succeed("")),
  );
  const self = repository.self;
  const entries = yield* Effect.forEach(repository.sources, ([file, source]) => Effect.gen(function* () {
    const specifiers = new Set(bareSpecifiers(source).filter((specifier) =>
      !specifier.includes(":") && (self === undefined || selfTarget(specifier, self) === undefined)));
    const directory = path.dirname(path.join(root, file));
    const imports = yield* Effect.forEach(specifiers, (specifier) => resolve(specifier, directory));
    return [file, imports.filter((imported) => known.has(imported))] as const;
  }), { concurrency: 16 });
  return new Map(entries);
});

const readRepository = Effect.fn("readRepository")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* workingTreeFiles(root);
  const read = (file: string) => fs.readFileString(path.join(root, file)).pipe(Effect.catchTag("PlatformError", () => Effect.succeed("")));
  const sources = new Map(yield* Effect.forEach(files.filter((file) => SOURCE_FILE.test(file)), (file) =>
    read(file).pipe(Effect.map((text) => [file, text] as const)), { concurrency: 16 }));
  const manifest = files.includes("package.json") ? yield* read("package.json").pipe(Effect.flatMap(decodeManifest)) : {};
  const bunfig = files.includes("bunfig.toml")
    ? yield* read("bunfig.toml").pipe(
        Effect.flatMap((text) => Effect.try({ try: (): unknown => Bun.TOML.parse(text), catch: (cause) => new NarrowingError({ message: "cannot parse bunfig.toml: " + String(cause) }) })),
        Effect.flatMap(decodeBunfig),
      )
    : {};
  const rawReach = (yield* loadSettings(root))["reach"];
  const refusal = refuseReachMap(rawReach);
  if (refusal !== undefined) return yield* new ReachMapError({ message: refusal });
  const decoded = rawReach === undefined ? undefined : yield* decodeSetting("reach", Reach, rawReach);
  const repository = {
    files,
    sources,
    bins: binsOf(manifest),
    self: manifest.name === undefined ? undefined : { name: manifest.name, exports: exportsMap(manifest.exports) },
    preloads: preloadPaths(bunfig),
    reach: Object.entries(decoded ?? {}).map(([changed, tests]) => ({ changed, tests })),
  } satisfies Repository;
  return { ...repository, packageImports: yield* readPackageImports(root, repository) } satisfies Repository;
});

const readDefaultNarrowing = Effect.fn("readDefaultNarrowing")(function* (root: string, changed: readonly string[], tests: readonly string[], tier?: TestTier, base?: string) {
  const mapChange: ReachChange = !changed.includes(SETTINGS_FILE)
    ? { kind: "mapped", patterns: [] }
    : base === undefined ? { kind: "full" } : yield* readReachChange(root, base);
  if (mapChange.kind === "full") {
    return { kind: "full", because: pullRequestReason(SETTINGS_FILE, "a config every test runs under") } satisfies Narrowing;
  }
  const repository = yield* readRepository(root);
  const problem = reachMapProblem(repository);
  if (problem !== undefined) return { kind: "full", because: problem } satisfies Narrowing;
  if (changed.length === 0) return { kind: "full", because: "the pull request changes no file" } satisfies Narrowing;
  const helpers = changed.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file) && testEnvironmentReason(file) === "a test helper");
  if (helpers.some((file) => preloadClosure(repository).has(file))) return { kind: "full", because: "a changed test helper is preloaded" } satisfies Narrowing;
  const helperTests = helpers.length === 0 ? new Set<string>() : yield* helperImpact(root, helpers, repository.sources, repository.files, graphOf(repository, helpers).readers).pipe(Effect.option, Effect.map(Option.getOrUndefined));
  if (helperTests === undefined) return { kind: "full", because: "the changed test helper's import graph cannot be resolved" } satisfies Narrowing;
  const remaining = changed.filter((file) => !helpers.includes(file) && file !== SETTINGS_FILE);
  const impact = remaining.length === 0 ? undefined : testImpact(remaining, repository, tests, tier);
  if (impact?.kind === "full") return impact;
  if (impact !== undefined) yield* reportImpact(impact.byChange);
  const reached = new Set([...(impact === undefined ? [] : [...impact.byChange.values()].flat()), ...helperTests, ...helpers.flatMap((file) => mappedTests(file, repository) ?? [])]);
  return { kind: "files", files: addReachTests(tests, reached, mapChange) } satisfies Narrowing;
});

export const readChangedNarrowing = Effect.fn("readChangedNarrowing")(function* (root: string, changed: readonly string[], tests: readonly string[], tier?: TestTier, base?: string) {
  if (tier !== "pixel") return yield* readDefaultNarrowing(root, changed, tests, tier, base);
  const impact = testImpact(changed, yield* readRepository(root), tests, tier);
  if (impact.kind === "files") yield* reportImpact(impact.byChange);
  return selectedTests(impact, tests);
});

export const readLocalNarrowing = Effect.fn("readLocalNarrowing")(function* (root: string, changed: readonly string[], tests: readonly string[]) {
  return yield* Effect.gen(function* () {
    return narrowLocalTests(changed, yield* readRepository(root), tests);
  }).pipe(Effect.catchTag("ReachMapError", (cause) => Effect.succeed<LocalNarrowing>({ kind: "full", because: cause.message })));
});
