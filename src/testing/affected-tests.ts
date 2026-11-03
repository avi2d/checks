import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { pathsSinceMergeBase, workingTreeFiles } from "../core/git.ts";
import { decodePullRequestEvent, pullRequestEndsOf } from "../core/lint.ts";
import { classifyPath } from "../core/scope.ts";
import { decodeBunfig, importedFile, importsOf, preloadPaths, resolved, TEST_TREE } from "./mutation-scope-graph.ts";

export type Narrowing =
  | { readonly kind: "full"; readonly because: string }
  | { readonly kind: "files"; readonly files: readonly string[] };

type SelfReference = {
  readonly name: string;
  readonly exports: ReadonlyMap<string, string>;
};

export type Repository = {
  readonly files: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly bins: ReadonlyMap<string, string>;
  readonly self: SelfReference | undefined;
  readonly preloads: readonly string[];
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

export function sharedReason(path: string, preloads: ReadonlySet<string>): string | undefined {
  if (path.startsWith(FIXTURES)) return undefined;
  const name = basenameOf(path);
  const directories = path.split("/").slice(0, -1);
  if (LOCKFILES.has(name)) return "a lockfile";
  if ((classifyPath(path) === "workflow" && !path.startsWith(WORKFLOWS)) || CONFIG.test(name) || TOOL_PINS.has(name)) {
    return "a config every test runs under";
  }
  if (preloads.has(path)) return "a file Bun preloads into every test";
  if (path.startsWith(TEST_TREE) && !TEST_FILE.test(path)) return "a test helper";
  if (STYLESHEET.test(name)) return "a stylesheet";
  if (FONT.test(name) || directories.includes("fonts")) return "a font";
  if (directories.includes("layouts") || LAYOUT.test(name)) return "a layout";
  return undefined;
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
export function narrowTests(changed: readonly string[], repository: Repository, tests: readonly string[]): Narrowing {
  if (changed.length === 0) return { kind: "full", because: "the pull request changes no file" };
  const preloads = preloadClosure(repository);
  for (const path of changed) {
    const reason = sharedReason(path, preloads);
    if (reason !== undefined) return { kind: "full", because: `the pull request changes ${path}, ${reason}` };
  }
  const reached = reach(graphOf(repository, changed), changed, repository.sources);
  return { kind: "files", files: tests.filter((test) => reached.has(test)) };
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
  return {
    files,
    sources,
    bins: binsOf(manifest),
    self: manifest.name === undefined ? undefined : { name: manifest.name, exports: exportsMap(manifest.exports) },
    preloads: preloadPaths(bunfig),
  } satisfies Repository;
});

const pullRequestEvent = Config.all({
  name: Config.String("GITHUB_EVENT_NAME").pipe(Config.withDefault("")),
  path: Config.String("GITHUB_EVENT_PATH").pipe(Config.withDefault("")),
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
    Effect.catch((cause) => Effect.succeed<Narrowing>({ kind: "full", because: "the pull request's changes cannot be read: " + cause.message })),
  ));
});
