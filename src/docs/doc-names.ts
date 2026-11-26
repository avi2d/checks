import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect, git, pathsAt } from "../core/git.ts";
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

const matchedAt = Effect.fn("matchedAt")(function* (root: string, rev: string, names: readonly string[]) {
  if (names.length === 0) return new Set<string>();
  const found = yield* git(["grep", "-I", "-F", "-h", "--no-color", "-f", "-", rev, "--", ...OUTSIDE_DOCS], root, {
    input: `${names.join("\n")}\n`,
  }).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));
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
