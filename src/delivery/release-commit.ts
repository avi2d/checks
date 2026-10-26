import { Console, Effect, FileSystem, Path, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { gitHubJson, REPOSITORY } from "./github.ts";
import { nextVersion, type Pending, readPending, releaseTitle, runBuild, withVersion } from "./release.ts";
import { git } from "../core/git.ts";

export class ReleaseRefused extends Schema.TaggedError<ReleaseRefused>()("ReleaseRefused", {
  message: Schema.String,
}) {}

type Staged =
  | { readonly kind: "written"; readonly path: string; readonly mode: string }
  | { readonly kind: "deleted"; readonly path: string; readonly mode: string };

type Read =
  | { readonly kind: "written"; readonly path: string; readonly mode: string; readonly content: string }
  | { readonly kind: "deleted"; readonly path: string; readonly mode: string };

type Built = {
  readonly tree: string;
  readonly files: readonly Read[];
};

export const MANIFEST = "package.json";
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const RAW_ENTRY = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])/;

const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));
const decodeSha = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ sha: Schema.String })));
export const decodeRef = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ ref: Schema.String })));

export function releaseBranchOf(base: string): string {
  return `release/${base}`;
}

export function stagedOf(raw: string): readonly Staged[] {
  const fields = raw.split("\0");
  const staged: Staged[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, from = "", to = "", status] = RAW_ENTRY.exec(fields[index] ?? "") ?? [];
    const path = fields[index + 1] ?? "";
    staged.push(status === "D" ? { kind: "deleted", path, mode: from } : { kind: "written", path, mode: to });
  }
  return staged;
}

export function refused(message: string): ReleaseRefused {
  return new ReleaseRefused({ message });
}

export const versionIn = (manifest: string): Effect.Effect<string | undefined> =>
  decodeVersion(manifest).pipe(
    Effect.map(({ version }) => version),
    Effect.orElseSucceed(() => undefined),
  );

const releaseVersion = Effect.fn("releaseVersion")(function* (manifest: string, { since, unreleased }: Pending, untagged: string) {
  const { version } = yield* decodeVersion(manifest).pipe(Effect.mapError((cause) => refused(`${MANIFEST}: ${cause.message}`)));
  if (since !== undefined && since !== `v${version}`) {
    return yield* refused(
      `${MANIFEST} holds ${version}, but the last release tag is ${since}, so v${version} is untagged; ${untagged}, or return its version to ${since.slice(1)}`,
    );
  }
  const next = nextVersion(version, unreleased);
  if (next === undefined) return yield* refused(`${MANIFEST} holds ${version}, which is no plain major.minor.patch version`);
  const bumped = withVersion(manifest, version, next);
  if (bumped === undefined || (yield* versionIn(bumped)) !== next) {
    return yield* refused(`cannot rewrite the version ${version} in ${MANIFEST} as ${next}`);
  }
  return { next, bumped };
});

const currentBranch = Effect.fn("currentBranch")(function* (root: string) {
  const branch = yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"], root).pipe(
    Effect.map((name) => name.trim()),
    Effect.catchTag("GitFailure", () => Effect.succeed("")),
  );
  if (branch === "") return yield* refused("HEAD is detached; check out the branch the release goes to");
  return branch;
});

export const hasBranch = Effect.fn("hasBranch")(function* (root: string, branch: string) {
  return (yield* git(["ls-remote", "origin", `refs/heads/${branch}`], root)).trim() !== "";
});

type Plan = {
  readonly base: string;
  readonly branch: string;
  readonly head: string;
  readonly next: string;
  readonly bumped: string;
};

// Undefined means nothing is unreleased, which it has already said.
export const planRelease = Effect.fn("planRelease")(function* (label: string, root: string, untagged: string) {
  const pending = yield* readPending(root);
  if (pending.unreleased.length === 0) {
    yield* Console.log(`${label}: no unreleased changes ${pending.since === undefined ? "with no tag yet" : `since ${pending.since}`}`);
    return undefined;
  }
  const base = yield* currentBranch(root);
  const head = (yield* git(["rev-parse", "HEAD"], root)).trim();
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { next, bumped } = yield* releaseVersion(manifest, pending, untagged);
  return { base, branch: releaseBranchOf(base), head, next, bumped } satisfies Plan;
});

const readStaged = Effect.fn("readStaged")(function* (root: string, staged: Staged) {
  if (staged.kind === "deleted") return staged;
  if (!REGULAR_FILE_MODES.has(staged.mode)) return yield* refused(`the build wrote ${staged.path} with mode ${staged.mode}, which is no regular file`);
  const bytes = yield* (yield* FileSystem.FileSystem).readFile((yield* Path.Path).join(root, staged.path));
  return { ...staged, content: Base64.encode(bytes) };
});

// The build writes into the working tree, so the tree it starts from has to hold nothing a release would sweep in.
export const buildRelease = Effect.fn("buildRelease")(function* (name: string, root: string, bumped: string) {
  if ((yield* git(["status", "--porcelain", "--untracked-files=no"], root)).trim() !== "") {
    return yield* refused("the working tree has changes to tracked files; the release commits only what the build writes");
  }
  const restore = git(["reset", "--quiet", "--hard", "HEAD"], root).pipe(
    Effect.catchTag("GitFailure", (failure) => Console.error(`${name}: cannot restore the working tree: ${failure.message}`)),
  );
  return yield* Effect.gen(function* () {
    yield* (yield* FileSystem.FileSystem).writeFileString((yield* Path.Path).join(root, MANIFEST), bumped);
    yield* runBuild(root);
    yield* git(["add", "--update"], root);
    const tree = (yield* git(["write-tree"], root)).trim();
    const staged = stagedOf(yield* git(["diff", "--cached", "--raw", "-z", "--no-renames", "HEAD"], root));
    return { tree, files: yield* Effect.forEach(staged, (one) => readStaged(root, one)) } satisfies Built;
  }).pipe(Effect.ensuring(restore));
});

const treeEntry = Effect.fn("treeEntry")(function* (file: Read) {
  if (file.kind === "deleted") return { path: file.path, mode: file.mode, type: "blob", sha: null };
  const { sha } = yield* gitHubJson(decodeSha, "POST", `${REPOSITORY}/git/blobs`, { content: file.content, encoding: "base64" });
  return { path: file.path, mode: file.mode, type: "blob", sha };
});

export const commitRelease = Effect.fn("commitRelease")(function* (root: string, head: string, built: Built, version: string) {
  const tree = yield* Effect.forEach(built.files, treeEntry);
  const baseTree = (yield* git(["rev-parse", `${head}^{tree}`], root)).trim();
  const made = yield* gitHubJson(decodeSha, "POST", `${REPOSITORY}/git/trees`, { base_tree: baseTree, tree });
  if (made.sha !== built.tree) return yield* refused(`GitHub built the tree ${made.sha}, but the build wrote ${built.tree}`);
  const commit = { message: releaseTitle(version), tree: made.sha, parents: [head] };
  return (yield* gitHubJson(decodeSha, "POST", `${REPOSITORY}/git/commits`, commit)).sha;
});

export const pointBranch = Effect.fn("pointBranch")(function* (branch: string, sha: string, exists: boolean) {
  yield* exists
    ? gitHubJson(decodeRef, "PATCH", `${REPOSITORY}/git/refs/heads/${branch}`, { sha, force: true })
    : gitHubJson(decodeRef, "POST", `${REPOSITORY}/git/refs`, { ref: `refs/heads/${branch}`, sha });
});
