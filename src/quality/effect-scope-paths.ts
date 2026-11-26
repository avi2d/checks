import { Effect, FileSystem, Path, Schema } from "effect";
import { minimatch } from "minimatch";
import { SOURCES } from "./presets/oxlint.ts";
import { git } from "../core/git.ts";

export class EffectScopeError extends Schema.TaggedError<EffectScopeError>()("EffectScopeError", {
  message: Schema.String,
}) {}

const UNSUPPORTED_GLOB = /[{}[\]!\\:]|(^|\/)\.{1,2}(\/|$)|\/\/|[^/]\*\*|\*\*[^/]/;

const pathFault = (source: string, pattern: string, alternative: string) =>
  new EffectScopeError({ message: `${source} pattern ${JSON.stringify(pattern)} cannot be mirrored in tsconfig.json; ${alternative}` });

const endsInGlobstar = (glob: string) => glob.endsWith("/**") || glob === "**";
const globstarWithLeaf = (glob: string) => endsInGlobstar(glob) ? `${glob}/*` : glob;

type ScopeGlob = { readonly glob: string; readonly pattern: string; readonly source: string };

export const scopeGlobs = Effect.fn("scopeGlobs")(function* (patterns: readonly string[], field: string) {
  return yield* Effect.forEach(patterns, (pattern) => {
    const fromRoot = pattern.startsWith("./");
    const plain = fromRoot ? pattern.slice(2) : pattern;
    if (UNSUPPORTED_GLOB.test(plain) || plain === "" || plain.startsWith("/") || plain.endsWith("/")) {
      return Effect.fail(pathFault(field, pattern, "use separate relative globs with * or ? instead"));
    }
    const recursive = fromRoot || plain.includes("/") ? plain : `**/${plain}`;
    const leaf = recursive.split("/").at(-1) ?? "";
    if (!/[.*?]/.test(leaf)) {
      return Effect.fail(pathFault(field, pattern, "name a file with an extension or use a directory glob ending in /**"));
    }
    // tsgo does not match an include that ends in **.
    return Effect.succeed({ glob: globstarWithLeaf(recursive), pattern, source: field });
  });
});

type IgnoreSource = { readonly file: string; readonly directory: string; readonly patterns: readonly string[] };

function literalDirectory(pattern: string): string {
  const segments = pattern.split("/").slice(0, -1);
  const wildcard = segments.findIndex((segment) => /[?*{}[\]!\\]/.test(segment));
  return segments.slice(0, wildcard === -1 ? segments.length : wildcard).join("/");
}

function outsideIncludes(pattern: string, directory: string, includes: readonly string[]): boolean {
  const negatedOff = pattern.replace(/^!/, "");
  const positive = negatedOff.replace(/^\//, "");
  const anchored = negatedOff.startsWith("/") || positive.replace(/\/$/, "").includes("/");
  const reach = anchored ? positive : "x";
  const prefix = literalDirectory(directory === "" ? reach : `${directory}/${reach}`);
  return prefix !== "" && includes.every((include) => {
    const included = literalDirectory(include);
    return included !== "" && included !== prefix && !included.startsWith(`${prefix}/`) && !prefix.startsWith(`${included}/`);
  });
}

function ignoreAlternatives(pattern: string): readonly string[] {
  const extension = pattern.slice(pattern.lastIndexOf("."));
  if (!/^\.[a-zA-Z]+\[[a-zA-Z]+\]$/.test(extension)
    || SOURCES.some((source) => minimatch(source.slice(source.lastIndexOf(".")), extension))) return [pattern];
  const start = pattern.lastIndexOf("[");
  return pattern.slice(start + 1, -1).split("").map((letter) => `${pattern.slice(0, start)}${letter}`);
}

const trackedNonTypeScriptNegation = Effect.fn("trackedNonTypeScriptNegation")(function* (root: string, pattern: string, directory: string, trackedFiles: ReadonlySet<string>) {
  if (!pattern.startsWith("!")) return false;
  const relative = pattern.slice(1).replace(/^\//, "");
  if ((!pattern.startsWith("!/") && !relative.includes("/")) || /[*?]/.test(relative) || UNSUPPORTED_GLOB.test(relative)) return false;
  const path = yield* Path.Path;
  const extension = path.extname(relative).toLowerCase();
  if (extension === "" || SOURCES.some((source) => source.endsWith(extension))) return false;
  const file = directory === "" ? relative : `${directory}/${relative}`;
  if (!trackedFiles.has(file)) return false;
  const fs = yield* FileSystem.FileSystem;
  const full = path.join(root, file);
  if (!(yield* fs.exists(full))) {
    return yield* new EffectScopeError({ message: `negation ${JSON.stringify(pattern)} names missing tracked file ${file}; restore that file or remove the negation` });
  }
  return (yield* fs.lstat(full)).type === "File";
});

const ignoreGlobs = Effect.fn("ignoreGlobs")(function* (root: string, { file, directory, patterns }: IgnoreSource, includes: readonly string[], trackedFiles: ReadonlySet<string>) {
  return yield* Effect.forEach(patterns, (line) => {
    const pattern = line.trimEnd();
    if (pattern === "" || pattern.startsWith("#")) return Effect.succeed([]);
    const directoryOnly = pattern.endsWith("/");
    const unanchored = pattern.replace(/^\//, "").replace(/\/$/, "");
    const alternatives = ignoreAlternatives(unanchored);
    if (unanchored === "" || alternatives.some((alternative) => UNSUPPORTED_GLOB.test(alternative))) {
      if (outsideIncludes(pattern, directory, includes)) return Effect.succeed([]);
      return trackedNonTypeScriptNegation(root, pattern, directory, trackedFiles).pipe(Effect.flatMap((safe) => safe
        ? Effect.succeed([])
        : Effect.fail(pathFault(file, line, "use separate positive file or directory patterns with * or ? instead"))));
    }
    return Effect.succeed(alternatives.map((alternative) => {
      const relative = pattern.startsWith("/") || alternative.includes("/") ? alternative : `**/${alternative}`;
      const rooted = directory === "" ? relative : `${directory}/${relative}`;
      const directoryGlob = endsInGlobstar(rooted) ? `${rooted.slice(0, -2)}*` : rooted;
      const glob = directoryOnly ? `${directoryGlob}/**/*` : globstarWithLeaf(rooted);
      return { glob, pattern: line, source: file };
    }));
  });
});

const readIgnore = Effect.fn("readIgnore")(function* (root: string, file: string, directory: string, includes: readonly string[], trackedFiles: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.resolve(root, file);
  if (!(yield* fs.exists(full))) return [];
  const text = (yield* fs.readFileString(full)).replace(/^\uFEFF/, "");
  return yield* ignoreGlobs(root, { file, directory, patterns: text.split(/\r?\n/) }, includes, trackedFiles).pipe(Effect.map((lists) => lists.flat()));
});

type ScopePaths = { readonly include: readonly ScopeGlob[]; readonly exclude: readonly ScopeGlob[] };

const matchesGlob = (file: string, glob: string, dot: boolean) => minimatch(file, glob, { dot, noext: true });
const matchesPath = (file: string, patterns: readonly ScopeGlob[], dot: boolean) =>
  patterns.some(({ glob }) => matchesGlob(file, glob, dot));

const utf8Bytes = (text: string) => Buffer.from(text).toString("latin1");

function questionFault(paths: readonly string[], patterns: readonly ScopeGlob[]): EffectScopeError | undefined {
  for (const { glob, pattern, source } of patterns) {
    if (!glob.includes("?")) continue;
    // Oxlint matches each ? against a byte, but tsgo matches a Unicode character.
    const different = paths.find((path) => /\P{ASCII}/u.test(path)
      && matchesGlob(path, glob, true) !== matchesGlob(utf8Bytes(path), utf8Bytes(glob), true));
    if (different !== undefined) return pathFault(source, pattern, `? selects ${different} differently; use literal paths instead`);
  }
  return undefined;
}

const parentPaths = (file: string) =>
  file.split("/").slice(0, -1).map((_, index, segments) => segments.slice(0, index + 1).join("/"));

const TSGO_DEPENDENCY_DIRS = new Set(["node_modules", "bower_components", "jspm_packages"]);

function matchesTsgoComponents(parts: readonly string[], pattern: readonly string[]): boolean {
  const [glob, ...tail] = pattern;
  if (glob === undefined) return parts.length === 0;
  const [part, ...next] = parts;
  if (glob === "**") {
    return matchesTsgoComponents(parts, tail) || (part !== undefined
      && !part.startsWith(".") && !TSGO_DEPENDENCY_DIRS.has(part) && matchesTsgoComponents(next, pattern));
  }
  if (part === undefined) return false;
  if (next.length > 0 && TSGO_DEPENDENCY_DIRS.has(part) && glob !== part) return false;
  return matchesGlob(part, glob, false) && matchesTsgoComponents(next, tail);
}

const matchesTsgoInclude = (file: string, include: readonly ScopeGlob[]) =>
  include.some(({ glob }) => matchesTsgoComponents(file.split("/"), glob.split("/")));

const isMinified = (file: string) => /[._-]min\./.test(file.split("/").at(-1) ?? "");

function selectionFault(file: string, { include, exclude }: ScopePaths, ignored: readonly ScopeGlob[]): EffectScopeError | undefined {
  const question = questionFault([file], include);
  if (question !== undefined) return question;
  if (!matchesPath(file, include, true)) return undefined;
  const directories = parentPaths(file);
  const paths = [file, ...directories];
  const excluded = questionFault(paths, [...exclude, ...ignored]);
  if (excluded !== undefined) return excluded;
  if (matchesPath(file, exclude, true) || paths.some((path) => matchesPath(path, ignored, true))) return undefined;
  const included = matchesTsgoInclude(file, include);
  const pruned = directories.find((directory) => matchesPath(directory, exclude, true));
  if (isMinified(file)) {
    return included && pruned === undefined
      ? new EffectScopeError({ message: `oxlint skips minified file ${file} but tsgo includes it; add ${file} to excludeFiles or rename it` })
      : undefined;
  }
  if (!included) {
    return new EffectScopeError({ message: `${file} matches oxlint files but tsgo wildcard includes skip some hidden and dependency paths; name ${file} explicitly in files or exclude its directory with a glob ending in /**` });
  }
  return pruned === undefined ? undefined : new EffectScopeError({
    message: `${file} is reached by oxlint but tsgo excludeFiles prunes directory ${pruned}; use ${pruned}/** to exclude its contents too, or rename that directory`,
  });
}

const withoutQuestionMarks = (glob: string) => glob.split("/").map((part) =>
  part.includes("?") ? part.replace(/[?*]+/g, "*") : part).join("/");

export const validateScopePaths = Effect.fn("validateScopePaths")(function* (root: string, overrides: readonly ScopePaths[], ignored: readonly ScopeGlob[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const includes = [...new Set(overrides.flatMap(({ include }) => include.map(({ glob }) => withoutQuestionMarks(glob))))];
  const skip = [".git/**", ...ignored.flatMap(({ glob }) => glob.includes("?") ? [] : [glob])];
  const reached = yield* Effect.forEach(includes, (include) => fs.glob(include, { root, dot: true, exclude: skip }));
  for (const file of [...new Set(reached.flat())].sort()) {
    if (!SOURCES.some((glob) => matchesGlob(file, glob, true)) || (yield* fs.stat(path.join(root, file))).type !== "File") continue;
    for (const override of overrides) {
      const fault = selectionFault(file, override, ignored);
      if (fault !== undefined) return yield* fault;
    }
  }
});

const CONFIG_NAMES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.mts", "oxlint.config.cts", "oxlint.config.js", "oxlint.config.mjs", "oxlint.config.cjs"];

export const OXLINT_CONFIG_NAMES: readonly string[] = ["oxlint.config.ts", ...CONFIG_NAMES];

const nestedConfigFault = (file: string) =>
  new EffectScopeError({ message: `${file} may change what oxlint checks; put its rules in ordered overrides in the root oxlint.config.ts instead` });

const gitScopeFiles = Effect.fn("gitScopeFiles")(function* (root: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(path.join(root, ".git")))) return [];
  const files = yield* git(["-c", "core.excludesFile=/dev/null", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...OXLINT_CONFIG_NAMES.map((name) => `:(glob)**/${name}`)], root);
  const nested = [...new Set(files.split("\0").filter((file) => file.includes("/")))].sort();
  yield* Effect.forEach(nested, (file) => Effect.gen(function* () {
    if (yield* fs.exists(path.join(root, file))) return yield* nestedConfigFault(file);
  }));
  const tracked = yield* git(["ls-files", "-z", "--cached"], root);
  return tracked.split("\0").filter(Boolean).sort();
});

export const globalExcludes = Effect.fn("globalExcludes")(function* (root: string, patterns: readonly string[], includes: readonly string[]) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  for (const file of CONFIG_NAMES) {
    if (yield* fs.exists(path.join(root, file))) return yield* nestedConfigFault(file);
  }
  if (yield* fs.exists(path.join(root, ".eslintignore"))) {
    return yield* new EffectScopeError({ message: ".eslintignore may change what oxlint checks; use ignorePatterns in oxlint.config.ts instead" });
  }
  const trackedFiles = new Set(yield* gitScopeFiles(root));
  const configured = yield* ignoreGlobs(root, { file: "oxlint ignorePatterns", directory: "", patterns }, includes, trackedFiles);
  const ignoreFiles = (yield* fs.exists(path.join(root, ".git")))
    ? (yield* git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ":(glob)**/.gitignore"], root)).split("\0").filter(Boolean)
    : [".gitignore"];
  const ignored = yield* Effect.forEach([...new Set(ignoreFiles)].sort(), (file) =>
    readIgnore(root, file, file.includes("/") ? path.dirname(file) : "", includes, trackedFiles));
  return [...configured.flat(), ...ignored.flat()];
});
