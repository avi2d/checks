import { Console, Effect, FileSystem, Path, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { gitHubJson, REPOSITORY } from "../core/github.ts";
import { hasCommitsSince, isPlainVersion, nextVersion, type Pending, readPending, releaseTitle, runBuild, withVersion, withWorkspaceVersion } from "./release.ts";
import { git } from "../core/git.ts";
import { MANIFEST, RELEASE_BRANCH_PREFIX, RELEASE_VERSION_ENV, releaseTag, taggedVersion } from "../core/release-names.ts";
import { publicWorkspaces, type Workspace } from "./workspace-packages.ts";
import { readsPublishWorkspaces } from "./caller-options.ts";
import { readWorkflowFiles } from "./site-names.ts";

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

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const RAW_ENTRY = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])/;

const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));
const decodeSha = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ sha: Schema.String })));
const decodeRef = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ ref: Schema.String })));

export function releaseBranchOf(base: string): string {
  return `${RELEASE_BRANCH_PREFIX}${base}`;
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

export type RequestedVersion = {
  readonly value: string;
  readonly source: "--version" | typeof RELEASE_VERSION_ENV;
};

const chosenVersion = Effect.fn("chosenVersion")(function* (version: string, needed: string, { value: requested, source }: RequestedVersion, since: string | undefined) {
  if (!isPlainVersion(requested)) return yield* refused(`${source} ${requested} is no plain major.minor.patch version`);
  if (Bun.semver.order(requested, version) <= 0) return yield* refused(`${source} ${requested} is not newer than ${version}, which ${MANIFEST} holds`);
  if (Bun.semver.order(requested, needed) < 0) {
    return yield* refused(`${source} ${requested} is below ${needed}, which the unreleased changes${since === undefined ? "" : ` since ${since}`} need`);
  }
  return requested;
});

const releaseVersion = Effect.fn("releaseVersion")(function* (manifest: string, { since, unreleased }: Pending, untagged: string, requested: RequestedVersion | undefined) {
  const { version } = yield* decodeVersion(manifest).pipe(Effect.mapError((cause) => refused(`${MANIFEST}: ${cause.message}`)));
  if (since !== undefined && since !== releaseTag(version)) {
    return yield* refused(
      `${MANIFEST} holds ${version}, but the last release tag is ${since}, so ${releaseTag(version)} is untagged; ${untagged}, or return its version to ${taggedVersion(since)}`,
    );
  }
  const needed = nextVersion(version, unreleased);
  if (needed === undefined) return yield* refused(`${MANIFEST} holds ${version}, which is no plain major.minor.patch version`);
  const next = requested === undefined ? needed : yield* chosenVersion(version, needed, requested, since);
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
export const planRelease = Effect.fn("planRelease")(function* (label: string, root: string, untagged: string, requested?: RequestedVersion) {
  const pending = yield* readPending(root);
  if (requested !== undefined && !(yield* hasCommitsSince(root, pending.since))) {
    return yield* refused(`${requested.source} ${requested.value} has no commit to release ${pending.since === undefined ? "with no tag yet" : `since ${pending.since}`}`);
  }
  if (requested === undefined && pending.unreleased.length === 0) {
    yield* Console.log(`${label}: no unreleased changes ${pending.since === undefined ? "with no tag yet" : `since ${pending.since}`}`);
    return undefined;
  }
  const base = yield* currentBranch(root);
  const head = (yield* git(["rev-parse", "HEAD"], root)).trim();
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { next, bumped } = yield* releaseVersion(manifest, pending, untagged, requested);
  return { base, branch: releaseBranchOf(base), head, next, bumped } satisfies Plan;
});

const readStaged = Effect.fn("readStaged")(function* (root: string, staged: Staged) {
  if (staged.kind === "deleted") return staged;
  if (!REGULAR_FILE_MODES.has(staged.mode)) return yield* refused(`the build wrote ${staged.path} with mode ${staged.mode}, which is no regular file`);
  const bytes = yield* (yield* FileSystem.FileSystem).readFile((yield* Path.Path).join(root, staged.path));
  return { ...staged, content: Base64.encode(bytes) };
});

// The build writes into the working tree, so the tree it starts from has to hold nothing a release would sweep in.
export const buildRelease = Effect.fn("buildRelease")(function* (name: string, root: string, bumped: string, requested?: string) {
  if ((yield* git(["status", "--porcelain", "--untracked-files=no"], root)).trim() !== "") {
    return yield* refused("the working tree has changes to tracked files; the release commits only what the build writes");
  }
  const restore = git(["reset", "--quiet", "--hard", "HEAD"], root).pipe(
    Effect.catchTag("GitFailure", (failure) => Console.error(`${name}: cannot restore the working tree: ${failure.message}`)),
  );
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.writeFileString(path.join(root, MANIFEST), bumped);
    const version = yield* versionIn(bumped);
    if (version === undefined) return yield* refused(`${MANIFEST} has no version`);
    if (readsPublishWorkspaces((yield* readWorkflowFiles(root)).map(({ workflow }) => workflow))) {
      const workspaces = yield* publicWorkspaces(root);
      for (const workspace of workspaces) {
        if (Bun.semver.order(version, workspace.version) < 0) {
          return yield* refused(`${workspace.path} holds ${workspace.version}, which is ahead of the release version ${version}; raise the root version past ${workspace.version} first`);
        }
        const rewritten = withVersion(workspace.text, workspace.version, version);
        if (rewritten === undefined) return yield* refused(`${workspace.path}: cannot rewrite version ${workspace.version}`);
        yield* fs.writeFileString(path.join(root, workspace.path), rewritten);
      }
      yield* syncWorkspaceLock(root, workspaces, version);
    }
    yield* runBuild(root, requested);
    yield* git(["add", "--update"], root);
    const tree = (yield* git(["write-tree"], root)).trim();
    const staged = stagedOf(yield* git(["diff", "--cached", "--raw", "-z", "--no-renames", "HEAD"], root));
    return { tree, files: yield* Effect.forEach(staged, (one) => readStaged(root, one)) } satisfies Built;
  }).pipe(Effect.ensuring(restore));
});

const syncWorkspaceLock = Effect.fn("syncWorkspaceLock")(function* (root: string, workspaces: readonly Workspace[], version: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, "bun.lock");
  if (!(yield* fs.exists(file))) return;
  const lock = yield* fs.readFileString(file);
  let updated = lock;
  for (const workspace of workspaces) {
    const dir = path.dirname(workspace.path);
    const rewritten = withWorkspaceVersion(updated, dir, workspace.version, version);
    if (rewritten === undefined) return yield* refused(`${file} holds no workspaces["${dir}"] version ${workspace.version}; run bun install and commit bun.lock`);
    updated = rewritten;
  }
  if (updated !== lock) yield* fs.writeFileString(file, updated);
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
