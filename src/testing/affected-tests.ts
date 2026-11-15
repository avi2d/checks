import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { pathsSinceMergeBase, workingTreeFiles } from "../core/git.ts";
import { decodePullRequestEvent, pullRequestEndsOf } from "../core/lint.ts";
import { classifyPath } from "../core/scope.ts";
import { decodeBunfig, importedFile, importsOf, preloadPaths, resolved, TEST_TREE } from "./mutation-scope-graph.ts";

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
};

const FIXTURES = "tests/fixtures/";
// A workflow runs the suite rather than being read by it, so a test that reads one names its path.
const WORKFLOWS = ".github/";
const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|astro|svelte|vue|sh)$/;
const LOCKFILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const TOOL_PINS = new Set([".bun-version", ".npmrc", ".nvmrc", ".node-version", ".tool-versions"]);
const CONFIG = /(?:^|\.)config\.(?:[cm]?[jt]s|json)$/;
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

const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const directoryNode = (directory: string): string => directory + "/";

// A site's reach map cannot lift these, since every test runs under them whichever page it opens.
function runnerReason(path: string, preloads: ReadonlySet<string>): string | undefined {
  const name = basenameOf(path);
  if (LOCKFILES.has(name)) return "a lockfile";
  if ((classifyPath(path) === "workflow" && !path.startsWith(WORKFLOWS)) || CONFIG.test(name) || TOOL_PINS.has(name)) {
    return "a config every test runs under";
  }
  if (preloads.has(path)) return "a file Bun preloads into every test";
  if (path.startsWith(TEST_TREE) && !TEST_FILE.test(path)) return "a test helper";
  return undefined;
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
  if (path.startsWith(FIXTURES)) return undefined;
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

export function refuseReachMap(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "package.json: checks.reach is not a map of changed paths to test files";
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "") return "package.json: checks.reach has an empty changed-path key";
    if (!Array.isArray(entry) || entry.length === 0) return `package.json: checks.reach lists no test file for ${key}`;
    const bad = entry.find((candidate) => typeof candidate !== "string" || candidate === "");
    if (bad !== undefined) return `package.json: checks.reach names an empty test file for ${key}`;
  }
  return undefined;
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
  if (!path.startsWith(FIXTURES)) return [];
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

function selfImports(text: string, self: SelfReference, known: ReadonlySet<string>): readonly string[] {
  return [...text.matchAll(BARE_IMPORT)].flatMap(([, viaImport = "", viaRequire = ""]) => {
    const target = selfTarget(viaImport || viaRequire, self);
    if (target === undefined || target === BUILT) return target === undefined ? [] : [BUILT];
    const found = importedFile(target, known);
    return found.length === 0 ? [BUILT] : found;
  });
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
    const self = repository.self === undefined ? [] : selfImports(text, repository.self, known);
    if (self.includes(BUILT)) builtReaders.add(file);
    const named = file.startsWith(TEST_TREE) ? mentioned(text, index) : [];
    for (const read of [...importsOf(file, text, known), ...self.filter((target) => target !== BUILT), ...named]) {
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
    pending.push(...importsOf(file, repository.sources.get(file) ?? "", known));
  }
  return loaded;
}

// A test or its helper reads a file it imports or names by path or bin, and a source reads only what it imports, at any depth.
// A source that names a path, as a registry does, would make every importer read every file it lists.
function reachMapProblem(repository: Repository): string | undefined {
  const stale = staleReachPatterns(repository);
  if (stale.length === 0) return undefined;
  return `package.json: checks.reach names ${stale.map((entry) => `${entry.pattern} for ${entry.changed}`).join(", ")}, which matches no test file`;
}

export function narrowTests(changed: readonly string[], repository: Repository, tests: readonly string[]): Narrowing {
  const problem = reachMapProblem(repository);
  if (problem !== undefined) return { kind: "full", because: problem };
  if (changed.length === 0) return { kind: "full", because: "the pull request changes no file" };
  const [shared] = sharedChanges(changed, repository);
  if (shared !== undefined) return { kind: "full", because: `the pull request changes ${shared.path}, ${shared.reason}` };
  return { kind: "files", files: reachedTests(changed, repository, tests) };
}

export function narrowLocalTests(changed: readonly string[], repository: Repository, tests: readonly string[]): LocalNarrowing {
  const problem = reachMapProblem(repository);
  if (problem !== undefined) return { kind: "full", because: problem };
  return { kind: "files", files: reachedTests(changed, repository, tests), shared: sharedChanges(changed, repository) };
}

function sharedChanges(changed: readonly string[], repository: Repository): readonly SharedChange[] {
  const preloads = preloadClosure(repository);
  return changed.flatMap((path) => {
    if (path.startsWith(FIXTURES)) return [];
    const reason = mappedTests(path, repository) === undefined ? sharedReason(path, preloads) : runnerReason(path, preloads);
    return reason === undefined ? [] : [{ path, reason }];
  });
}

function reachedTests(changed: readonly string[], repository: Repository, tests: readonly string[]): readonly string[] {
  const reached = reach(graphOf(repository, changed), changed, repository.sources);
  const mapped = new Set(changed.flatMap((path) => mappedTests(path, repository) ?? []));
  return tests.filter((test) => reached.has(test) || mapped.has(test));
}

export const Manifest = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(Schema.Unknown),
  bin: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
  checks: Schema.optionalKey(Schema.Struct({
    reach: Schema.optionalKey(Schema.Unknown),
  })),
});
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));
const ReachMap = Schema.Record(Schema.String, Schema.Array(Schema.String));
const decodeReachMap = Schema.decodeUnknownEffect(ReachMap);

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

const readRepository = Effect.fn("readRepository")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* workingTreeFiles(root);
  const read = (file: string) => fs.readFileString(path.join(root, file)).pipe(Effect.orElseSucceed(() => ""));
  const sources = new Map(yield* Effect.forEach(files.filter((file) => SOURCE_FILE.test(file)), (file) =>
    read(file).pipe(Effect.map((text) => [file, text] as const)), { concurrency: 16 }));
  const manifest = files.includes("package.json") ? yield* read("package.json").pipe(Effect.flatMap(decodeManifest)) : {};
  const bunfig = files.includes("bunfig.toml")
    ? yield* read("bunfig.toml").pipe(
        Effect.flatMap((text) => Effect.try({ try: (): unknown => Bun.TOML.parse(text), catch: (cause) => new NarrowingError({ message: "cannot parse bunfig.toml: " + String(cause) }) })),
        Effect.flatMap(decodeBunfig),
      )
    : {};
  const rawReach = manifest.checks?.reach;
  const refusal = refuseReachMap(rawReach);
  if (refusal !== undefined) return yield* new ReachMapError({ message: refusal });
  const decoded = rawReach === undefined
    ? undefined
    : yield* decodeReachMap(rawReach).pipe(
      Effect.mapError((cause) => new ReachMapError({ message: `package.json: ${cause.message}` })),
    );
  return {
    files,
    sources,
    bins: binsOf(manifest),
    self: manifest.name === undefined ? undefined : { name: manifest.name, exports: exportsMap(manifest.exports) },
    preloads: preloadPaths(bunfig),
    reach: Object.entries(decoded ?? {}).map(([changed, tests]) => ({ changed, tests })),
  } satisfies Repository;
});

const pullRequestEvent = Config.all({
  name: Config.String("GITHUB_EVENT_NAME").pipe(Config.withDefault("")),
  path: Config.String("GITHUB_EVENT_PATH").pipe(Config.withDefault("")),
});

export const readLocalNarrowing = Effect.fn("readLocalNarrowing")(function* (root: string, changed: readonly string[], tests: readonly string[]) {
  return yield* Effect.gen(function* () {
    return narrowLocalTests(changed, yield* readRepository(root), tests);
  }).pipe(Effect.catchTag("ReachMapError", (cause) => Effect.succeed<LocalNarrowing>({ kind: "full", because: cause.message })));
});

// Only a pull_request run has a base to diff against; every other run keeps the suite whole.
export const readPullRequestNarrowing = Effect.fn("readPullRequestNarrowing")(function* (root: string, tests: readonly string[]) {
  const event = yield* pullRequestEvent.pipe(Effect.orElseSucceed(() => ({ name: "", path: "" })));
  if (event.name !== "pull_request" || event.path === "") return Option.none<Narrowing>();
  const narrowing = Effect.gen(function* () {
    const text = yield* (yield* FileSystem.FileSystem).readFileString(event.path);
    const { pull_request: pullRequest } = yield* decodePullRequestEvent(text);
    const { base, head } = pullRequestEndsOf(pullRequest);
    const changed = yield* pathsSinceMergeBase(base, head, root);
    return narrowTests(changed, yield* readRepository(root), tests);
  });
  return Option.some(yield* narrowing.pipe(
    Effect.catchTag("ReachMapError", (cause) => Effect.succeed<Narrowing>({ kind: "full", because: cause.message })),
    Effect.catch((cause) => Effect.succeed<Narrowing>({ kind: "full", because: "the pull request's changes cannot be read: " + cause.message })),
  ));
});
