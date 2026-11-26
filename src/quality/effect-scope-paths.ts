import { Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";

export class EffectScopeError extends Schema.TaggedError<EffectScopeError>()("EffectScopeError", {
  message: Schema.String,
}) {}

const UNSUPPORTED_GLOB = /[{}[\]!\\:]|(^|\/)\.{1,2}(\/|$)|\/\/|[^/]\*\*|\*\*[^/]/;

const pathFault = (source: string, pattern: string, alternative: string) =>
  new EffectScopeError({ message: `${source} pattern ${JSON.stringify(pattern)} cannot be mirrored in tsconfig.json; ${alternative}` });

const globstarWithLeaf = (glob: string) => glob.endsWith("/**") || glob === "**" ? `${glob}/*` : glob;

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
    return Effect.succeed(globstarWithLeaf(recursive));
  });
});

type IgnoreSource = { readonly file: string; readonly directory: string; readonly patterns: readonly string[] };

const ignoreGlobs = Effect.fn("ignoreGlobs")(function* ({ file, directory, patterns }: IgnoreSource) {
  return yield* Effect.forEach(patterns, (line) => {
    const pattern = line.trimEnd();
    if (pattern === "" || pattern.startsWith("#")) return Effect.succeed([]);
    const directoryOnly = pattern.endsWith("/");
    const unanchored = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (unanchored === "" || UNSUPPORTED_GLOB.test(unanchored)) {
      return Effect.fail(pathFault(file, line, "use separate positive file or directory patterns with * or ? instead"));
    }
    const relative = pattern.startsWith("/") || unanchored.includes("/") ? unanchored : `**/${unanchored}`;
    const rooted = directory === "" ? relative : `${directory}/${relative}`;
    return Effect.succeed([directoryOnly ? `${rooted}/**/*` : globstarWithLeaf(rooted)]);
  });
});

const readIgnore = Effect.fn("readIgnore")(function* (root: string, file: string, directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.resolve(root, file);
  if (!(yield* fs.exists(full))) return [];
  const text = yield* fs.readFileString(full);
  return yield* ignoreGlobs({ file, directory, patterns: text.split(/\r?\n/) }).pipe(Effect.map((lists) => lists.flat()));
});

const CONFIG_NAMES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.mts", "oxlint.config.cts", "oxlint.config.js", "oxlint.config.mjs", "oxlint.config.cjs"];

const nestedConfigFault = (file: string) =>
  new EffectScopeError({ message: `${file} may change what oxlint checks; put its rules in ordered overrides in the root oxlint.config.ts instead` });

const gitScopeIgnores = Effect.fn("gitScopeIgnores")(function* (root: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(path.join(root, ".git")))) return [];
  const sources = [".gitignore", "oxlint.config.ts", ...CONFIG_NAMES];
  const files = yield* git(["-c", "core.excludesFile=/dev/null", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...sources.map((name) => `:(glob)**/${name}`)], root);
  const nested = [...new Set(files.split("\0").filter((file) => file.includes("/")))].sort();
  const found = yield* Effect.forEach(nested, (file) => {
    if (path.basename(file) === ".gitignore") return readIgnore(root, file, path.dirname(file));
    return fs.exists(path.join(root, file)).pipe(Effect.flatMap((exists) => exists ? Effect.fail(nestedConfigFault(file)) : Effect.succeed([])));
  });
  const localExclude = yield* git(["rev-parse", "--git-path", "info/exclude"], root);
  return [...found.flat(), ...(yield* readIgnore(root, localExclude.trim(), ""))];
});

export const globalExcludes = Effect.fn("globalExcludes")(function* (root: string, patterns: readonly string[]) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  for (const file of CONFIG_NAMES) {
    if (yield* fs.exists(path.join(root, file))) return yield* nestedConfigFault(file);
  }
  if (yield* fs.exists(path.join(root, ".eslintignore"))) {
    return yield* new EffectScopeError({ message: ".eslintignore may change what oxlint checks; use ignorePatterns in oxlint.config.ts instead" });
  }
  const configured = yield* ignoreGlobs({ file: "oxlint ignorePatterns", directory: "", patterns });
  return [
    ...configured.flat(),
    ...(yield* readIgnore(root, ".gitignore", "")),
    ...(yield* gitScopeIgnores(root)),
  ];
});
