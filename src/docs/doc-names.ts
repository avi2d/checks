import { Effect, Option, Schema } from "effect";
import { collect, git, pathsAt } from "../core/git.ts";
import type { Unresolved } from "./doc-references.ts";
import { scanMarkdown } from "./prose-matchers.ts";

export type VanishedName = { readonly path: string; readonly line: number; readonly named: string; readonly message: string };

const OUTSIDE_DOCS = [".", ":(exclude)*.md"];
const NOT_ONE_NAME = /\s|<[^>]*>|^-/;
const HAS_LETTER = /[A-Za-z]/;

// A specifier of this package, or a path into an install, names the file it resolves to.
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

class DepsUnreadable extends Schema.TaggedError<DepsUnreadable>()("DepsUnreadable", {
  message: Schema.String,
}) {}

const decodeDeps = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

// git grep exits 1 when nothing matches, which is an answer rather than a failure.
const matchedAt = Effect.fn("matchedAt")(function* (root: string, rev: string, names: readonly string[]) {
  if (names.length === 0) return new Set<string>();
  const found = yield* git(["grep", "-I", "-F", "-o", "-h", "--no-color", "-f", "-", rev, "--", ...OUTSIDE_DOCS], root, {
    input: `${names.join("\n")}\n`,
  }).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));
  const paths = (yield* pathsAt(rev, [], root)).join("\n");
  return new Set([...found.split("\n"), ...names.filter((name) => paths.includes(name))]);
});

// -o reports one pattern per match, so a name inside a longer name's match is confirmed on its own.
const heldAt = Effect.fn("heldAt")(function* (root: string, rev: string, name: string) {
  return yield* git(["grep", "-I", "-F", "-q", "-e", name, rev, "--", ...OUTSIDE_DOCS], root).pipe(
    Effect.as(true),
    Effect.catchTag("GitFailure", () => Effect.succeed(false)),
  );
});

const packageName = Effect.fn("packageName")(function* (root: string, head: string) {
  const manifest = yield* git(["show", `${head}:package.json`], root).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));
  return /"name"\s*:\s*"([^"]+)"/.exec(manifest)?.[1];
});

const directDeps = Effect.fn("directDeps")(function* (root: string, head: string) {
  const manifest = yield* git(["show", `${head}:package.json`], root).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));
  const parsed: unknown = yield* Effect.try({
    try: () => JSON.parse(manifest) as unknown,
    catch: () => new DepsUnreadable({ message: "package.json does not parse as JSON" }),
  }).pipe(Effect.catchTag("DepsUnreadable", () => Effect.succeed({})));
  const empty: Record<string, unknown> = {};
  const fields = Option.getOrElse(decodeDeps(parsed), () => empty);
  return [
    ...new Set(
      ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((key) => {
        const group = fields[key];
        return typeof group === "object" && group !== null ? Object.keys(group) : [];
      }),
    ),
  ];
});

// A name the range moves into an installed direct dependency is still present, so it is not vanished.
const installedAt = Effect.fn("installedAt")(function* (root: string, deps: readonly string[], names: readonly string[]) {
  if (deps.length === 0 || names.length === 0) return new Set<string>();
  const { stdout } = yield* collect(
    "grep",
    ["-R", "-I", "-F", "-o", "-h", "--no-color", "-f", "-", "--", ...deps.map((dep) => `node_modules/${dep}`)],
    root,
    { input: `${names.join("\n")}\n` },
  ).pipe(Effect.orElseSucceed(() => ({ stdout: "" })));
  return new Set(stdout.split("\n").filter((line) => line !== ""));
});

export const vanishedNames = Effect.fn("vanishedNames")(function* (
  root: string,
  base: string,
  head: string,
  texts: ReadonlyMap<string, string>,
  failed: readonly (Unresolved & { readonly path: string })[],
  ownPackage?: string,
) {
  const resolved = ownPackage ?? (yield* packageName(root, head));
  const named = namesIn(texts, resolved);
  const names = [...new Set(named.map(({ name }) => name))];
  const atHead = yield* matchedAt(root, head, names);
  const candidates = names.filter((name) => !atHead.has(name));
  const atBase = yield* matchedAt(root, base, candidates);
  const gone = candidates.filter((name) => atBase.has(name));
  const confirmed = yield* Effect.forEach(gone, (name) => heldAt(root, head, name), { concurrency: 8 });
  const installed = yield* installedAt(root, yield* directDeps(root, head), gone);
  const vanished = new Set(gone.filter((_, index) => confirmed[index] === false && !installed.has(gone[index] ?? "")));
  // A span the reference check already reports as a broken path is not reported a second time.
  const reported = new Set(
    failed.flatMap((one) => (one.kind === "path" ? [`${one.path}:${one.line}:${nameOf(one.named, resolved) ?? one.named}`] : [])),
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
