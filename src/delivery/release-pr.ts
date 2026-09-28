#!/usr/bin/env bun
import { Console, Effect, Encoding, FileSystem, Path, Schema } from "effect";
import { dispatch, gitHubJson, REPOSITORY } from "./github.ts";
import { nextVersion, type Pending, readPending, releaseTitle, runBuild, withVersion } from "./release.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

class ReleaseRefused extends Schema.TaggedError<ReleaseRefused>()("ReleaseRefused", {
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

type Remote = {
  readonly parents: readonly string[];
  readonly version: string | undefined;
};

const NAME = "checks-release-pr";
const USAGE = "usage: release-pr.ts <workflow>...";
const MANIFEST = "package.json";
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const RAW_ENTRY = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])/;

const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));
const decodeSha = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ sha: Schema.String })));
const decodeRef = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ ref: Schema.String })));
const PullRequest = Schema.Struct({ number: Schema.Int, title: Schema.String, html_url: Schema.String });
type PullRequest = typeof PullRequest.Type;
const decodePullRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequest));
const decodePullRequests = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(PullRequest)));

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

const refused = (message: string) => new ReleaseRefused({ message });

const versionIn = (manifest: string) =>
  decodeVersion(manifest).pipe(
    Effect.map(({ version }) => version),
    Effect.orElseSucceed(() => undefined),
  );

const releaseVersion = Effect.fn("releaseVersion")(function* (manifest: string, { since, unreleased }: Pending) {
  const { version } = yield* decodeVersion(manifest).pipe(Effect.mapError((cause) => refused(`${MANIFEST}: ${cause.message}`)));
  if (since !== undefined && since !== `v${version}`) {
    return yield* refused(
      `${MANIFEST} holds ${version}, but the last release tag is ${since}, so v${version} is untagged; rerun the tag job of daily-release on the release commit, whose refusal says what to fix, or return its version to ${since.slice(1)}`,
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

const readRemote = Effect.fn("readRemote")(function* (root: string, branch: string) {
  if ((yield* git(["ls-remote", "origin", `refs/heads/${branch}`], root)).trim() === "") return undefined;
  const tracking = `refs/remotes/origin/${branch}`;
  yield* git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:${tracking}`], root);
  const [, ...parents] = (yield* git(["rev-list", "--parents", "-n", "1", tracking], root)).trim().split(" ");
  const version = yield* git(["show", `${tracking}:${MANIFEST}`], root).pipe(
    Effect.flatMap(versionIn),
    Effect.orElseSucceed(() => undefined),
  );
  return { parents, version } satisfies Remote;
});

const readStaged = Effect.fn("readStaged")(function* (root: string, staged: Staged) {
  if (staged.kind === "deleted") return staged;
  if (!REGULAR_FILE_MODES.has(staged.mode)) return yield* refused(`the build wrote ${staged.path} with mode ${staged.mode}, which is no regular file`);
  const bytes = yield* (yield* FileSystem.FileSystem).readFile((yield* Path.Path).join(root, staged.path));
  return { ...staged, content: Encoding.encodeBase64(bytes) };
});

// The build writes into the working tree, so the tree it starts from has to hold nothing a release would sweep in.
const buildRelease = Effect.fn("buildRelease")(function* (root: string, bumped: string) {
  if ((yield* git(["status", "--porcelain", "--untracked-files=no"], root)).trim() !== "") {
    return yield* refused("the working tree has changes to tracked files; the release commits only what the build writes");
  }
  const restore = git(["reset", "--quiet", "--hard", "HEAD"], root).pipe(
    Effect.catchTag("GitFailure", (failure) => Console.error(`${NAME}: cannot restore the working tree: ${failure.message}`)),
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

const commitRelease = Effect.fn("commitRelease")(function* (root: string, head: string, built: Built, version: string) {
  const tree = yield* Effect.forEach(built.files, treeEntry);
  const baseTree = (yield* git(["rev-parse", `${head}^{tree}`], root)).trim();
  const made = yield* gitHubJson(decodeSha, "POST", `${REPOSITORY}/git/trees`, { base_tree: baseTree, tree });
  if (made.sha !== built.tree) return yield* refused(`GitHub built the tree ${made.sha}, but the build wrote ${built.tree}`);
  const commit = { message: releaseTitle(version), tree: made.sha, parents: [head] };
  return (yield* gitHubJson(decodeSha, "POST", `${REPOSITORY}/git/commits`, commit)).sha;
});

const pointBranch = Effect.fn("pointBranch")(function* (branch: string, sha: string, exists: boolean) {
  yield* exists
    ? gitHubJson(decodeRef, "PATCH", `${REPOSITORY}/git/refs/heads/${branch}`, { sha, force: true })
    : gitHubJson(decodeRef, "POST", `${REPOSITORY}/git/refs`, { ref: `refs/heads/${branch}`, sha });
});

const findOpen = Effect.fn("findOpen")(function* (base: string, branch: string) {
  const query = `head={owner}:${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}&state=open`;
  const [open] = yield* gitHubJson(decodePullRequests, "GET", `${REPOSITORY}/pulls?${query}`);
  return open;
});

const titlePullRequest = Effect.fn("titlePullRequest")(function* (open: PullRequest | undefined, base: string, branch: string, version: string) {
  const title = releaseTitle(version);
  const body = `Release ${version}.`;
  if (open === undefined) {
    const created = yield* gitHubJson(decodePullRequest, "POST", `${REPOSITORY}/pulls`, { title, head: branch, base, body });
    return { verb: "opened", url: created.html_url };
  }
  if (open.title !== title) yield* gitHubJson(decodePullRequest, "PATCH", `${REPOSITORY}/pulls/${open.number}`, { title, body });
  return { verb: "refreshed", url: open.html_url };
});

const releasePullRequest = Effect.gen(function* () {
  const workflows = process.argv.slice(2);
  if (workflows.length === 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const pending = yield* readPending(root);
  if (pending.unreleased.length === 0) {
    yield* Console.log(`release-pr: no unreleased changes ${pending.since === undefined ? "with no tag yet" : `since ${pending.since}`}`);
    return true;
  }
  const base = yield* currentBranch(root);
  const branch = releaseBranchOf(base);
  const head = (yield* git(["rev-parse", "HEAD"], root)).trim();
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { next, bumped } = yield* releaseVersion(manifest, pending);
  const remote = yield* readRemote(root, branch);
  const current = remote?.version === next && remote.parents.length === 1 && remote.parents[0] === head;
  const open = yield* findOpen(base, branch);
  if (current && open?.title === releaseTitle(next)) {
    yield* Console.log(`release-pr: ${open.html_url} releases ${next} from ${head.slice(0, 12)} and is current`);
    return true;
  }
  if (!current) yield* pointBranch(branch, yield* commitRelease(root, head, yield* buildRelease(root, bumped), next), remote !== undefined);
  const { verb, url } = yield* titlePullRequest(open, base, branch, next);
  yield* Effect.forEach(workflows, (workflow) => dispatch(workflow, branch));
  yield* Console.log(`release-pr: ${verb} ${url} to release ${next}, and dispatched ${workflows.join(", ")} on ${branch}`);
  return true;
});

if (import.meta.main) runMain(NAME, releasePullRequest);
