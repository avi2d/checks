import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect, pathsAt } from "../core/git.ts";
import type { Unresolved } from "./doc-references.ts";
import type { RepositoryManifest } from "./doc-snapshot.ts";
import { scanMarkdown } from "./prose-matchers.ts";

export type VanishedName = { readonly path: string; readonly line: number; readonly named: string; readonly message: string };

const OUTSIDE_DOCS = [".", ":(exclude)*.md"];
const NOT_ONE_NAME = /\s|<[^>]*>|^-/;
const HAS_LETTER = /[A-Za-z]/;

function nameOf(span: string, ownPackage: string | undefined): string | undefined {
  if (span.length < 3 || !HAS_LETTER.test(span) || NOT_ONE_NAME.test(span)) return undefined;
  let name = span
    .replace(/^(["'])(.*)\1$/, "$2")
    .replace(/^(?:\.|~)\//, "")
    .replace(/^node_modules\//, "");
  if (ownPackage !== undefined && name.startsWith(`${ownPackage}/`)) name = name.slice(ownPackage.length + 1);
  return name.length < 3 ? undefined : name;
}

function namesIn(texts: ReadonlyMap<string, string>, ownPackage: string | undefined): readonly { path: string; line: number; name: string }[] {
  return [...texts].flatMap(([path, text]) =>
    scanMarkdown(text).flatMap((line) =>
      line.kind === "code" || line.kind === "front-matter"
        ? []
        : [...new Set(line.code)].flatMap((span) => {
            const name = nameOf(span, ownPackage);
            return name === undefined ? [] : [{ path, line: line.line, name }];
          }),
    ),
  );
}

class InstalledUnreadable extends Schema.TaggedError<InstalledUnreadable>()("InstalledUnreadable", {
  message: Schema.String,
}) {}

// Both PCRE and POSIX ERE read a backslash before each of these as the character itself.
const REGEX_SPECIAL = /[\\^$.|?*+()[{]/g;
// PCRE2's default build refuses a pattern that compiles past 64K code units.
// A name compiles to at most two units a byte and three for its branch, so this cost never undercounts.
const COMPILED_UNITS = 60_000;
const BRANCH_UNITS = 4;
const encoder = new TextEncoder();

export type Syntax = "-P" | "-E";

export function alternationsOf(names: readonly string[]): readonly string[] {
  const alternations: string[][] = [];
  let branches: string[] = [];
  let units = 0;
  for (const name of names) {
    const cost = 2 * encoder.encode(name).length + BRANCH_UNITS;
    if (branches.length > 0 && units + cost > COMPILED_UNITS) {
      alternations.push(branches);
      branches = [];
      units = 0;
    }
    branches.push(name.replace(REGEX_SPECIAL, "\\$&"));
    units += cost;
  }
  if (branches.length > 0) alternations.push(branches);
  return alternations.map((alternation) => alternation.join("|"));
}

const NO_LINE_MATCHED = ChildProcessSpawner.ExitCode(1);

// Undefined when git refuses the pattern, as a git built without PCRE refuses -P.
export const linesMatching = Effect.fn("linesMatching")(function* (root: string, rev: string, syntax: Syntax, alternation: string) {
  const args = ["grep", "-I", syntax, "-h", "--no-color", "-f", "-", rev, "--", ...OUTSIDE_DOCS];
  const { stdout, exitCode } = yield* collect("git", args, root, { input: `${alternation}\n` });
  if (exitCode === ChildProcessSpawner.ExitCode(0)) return stdout;
  return exitCode === NO_LINE_MATCHED ? "" : undefined;
});

const linesMatchingAny = Effect.fn("linesMatchingAny")(function* (root: string, rev: string, alternation: string) {
  return (yield* linesMatching(root, rev, "-P", alternation)) ?? (yield* linesMatching(root, rev, "-E", alternation)) ?? "";
});

// Git matches each -F pattern, and each line of a -f file, on its own against every line, so the
// cost grows with the pattern count. One alternation per call keeps it to a pass over the tree.
export const linesHolding = Effect.fn("linesHolding")(function* (root: string, rev: string, names: readonly string[]) {
  const found = yield* Effect.forEach(alternationsOf(names), (alternation) => linesMatchingAny(root, rev, alternation));
  return found.join("");
});

const matchedAt = Effect.fn("matchedAt")(function* (root: string, rev: string, names: readonly string[]) {
  if (names.length === 0) return new Set<string>();
  const found = yield* linesHolding(root, rev, names);
  const paths = (yield* pathsAt(rev, [], root)).join("\n");
  return new Set(names.filter((name) => found.includes(name) || paths.includes(name)));
});

const installedDirs = Effect.fn("installedDirs")(function* (root: string, deps: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dirs = deps.map((dep) => `node_modules/${dep}/`);
  const present = yield* Effect.forEach(dirs, (dir) => fs.exists(path.join(root, dir)), { concurrency: 8 });
  return dirs.filter((_, index) => present[index] === true);
});

const installedHolds = Effect.fn("installedHolds")(function* (root: string, dirs: readonly string[], name: string) {
  if (dirs.length === 0) return false;
  const { stderr, exitCode } = yield* collect("grep", ["-r", "-I", "-F", "-q", "-e", name, "--", ...dirs], root);
  if (exitCode === ChildProcessSpawner.ExitCode(0)) return true;
  if (exitCode === ChildProcessSpawner.ExitCode(1)) return false;
  return yield* new InstalledUnreadable({ message: `grep for \`${name}\` in ${dirs.join(", ")}: ${stderr.trim()}` });
});

export const vanishedNames = Effect.fn("vanishedNames")(function* (
  { root, base, head }: { readonly root: string; readonly base: string; readonly head: string },
  manifest: RepositoryManifest,
  texts: ReadonlyMap<string, string>,
  failed: readonly (Unresolved & { readonly path: string })[],
) {
  const named = namesIn(texts, manifest.name);
  const names = [...new Set(named.map(({ name }) => name))];
  const atHead = yield* matchedAt(root, head, names);
  const candidates = names.filter((name) => !atHead.has(name));
  const atBase = yield* matchedAt(root, base, candidates);
  const unheld = candidates.filter((name) => atBase.has(name));
  const dirs = yield* installedDirs(root, manifest.deps);
  const installed = yield* Effect.forEach(unheld, (name) => installedHolds(root, dirs, name), { concurrency: 8 });
  const vanished = new Set(unheld.filter((_, index) => installed[index] === false));
  const reported = new Set(
    failed.flatMap((one) => (one.kind === "path" ? [`${one.path}:${one.line}:${nameOf(one.named, manifest.name) ?? one.named}`] : [])),
  );
  return named
    .filter(({ name }) => vanished.has(name))
    .filter(({ path, line, name }) => !reported.has(`${path}:${line}:${name}`))
    .map(
      ({ path, line, name }): VanishedName => ({
        path,
        line,
        named: name,
        message: `names \`${name}\`, which the range removed from every file outside the docs. Say what holds now, or drop the line`,
      }),
    );
});
