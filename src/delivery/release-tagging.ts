import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { dispatch, GitHubFailure, gitHubJson, REPOSITORY } from "../core/github.ts";
import { ChildProcessSpawner } from "effect/process";
import { lastTag, runBuild } from "./release.ts";
import { extractReleaseNotes } from "./release-notes.ts";
import { publishPackage } from "./release-publish.ts";
import { checkTestedTree } from "./tested-tree.ts";
import { git } from "../core/git.ts";
import { MANIFEST, releasedVersionOf, releaseTag, taggedVersion } from "../core/release-names.ts";

class TagRefused extends Schema.TaggedError<TagRefused>()("TagRefused", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String, private: Schema.optionalKey(Schema.Boolean) })));
const decodeRelease = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ id: Schema.Int })));

// An annotated tag lists its own object first and the commit it tags on a `^{}` line after it.
export function taggedCommitOf(listed: string): string | undefined {
  const lines = listed.split("\n").filter((line) => line !== "");
  const peeled = lines.find((line) => line.endsWith("^{}")) ?? lines[0];
  return peeled?.split("\t")[0];
}

const taggedOn = Effect.fn("taggedOn")(function* (root: string, tag: string) {
  return taggedCommitOf(yield* git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root));
});

type Landed = { readonly head: string; readonly version: string; readonly tag: string; readonly publishes: boolean };

const landedRelease = Effect.fn("landedRelease")(function* (label: string, root: string) {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const version = releasedVersionOf(subject);
  if (version === undefined) {
    yield* Console.log(`${label}: ${head.slice(0, 12)} is no release commit`);
    return undefined;
  }
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const held = yield* decodeManifest(manifest).pipe(Effect.mapError((cause) => new TagRefused({ message: `${MANIFEST}: ${cause.message}` })));
  if (held.version !== version) return yield* new TagRefused({ message: `${head.slice(0, 12)} releases ${version}, but ${MANIFEST} holds ${held.version}` });
  return { head, version, tag: releaseTag(version), publishes: held.private !== true } satisfies Landed;
});

// Returns false when the tag already tags the head, so a rerun pushes nothing.
const pushReleaseTag = Effect.fn("pushReleaseTag")(function* (label: string, root: string, { head, version, tag }: Landed, cuttingWorkflow: string) {
  const tagged = yield* taggedOn(root, tag);
  if (tagged === head) {
    yield* Console.log(`${label}: ${tag} already tags ${head.slice(0, 12)}`);
    return false;
  }
  if (tagged !== undefined) return yield* new TagRefused({ message: `${tag} already tags ${tagged.slice(0, 12)}, not ${head.slice(0, 12)}` });
  yield* runBuild(root);
  const rebuilt = (yield* git(["diff", "--name-only"], root)).trim().split("\n").filter((file) => file !== "");
  if (rebuilt.length > 0) {
    const since = yield* lastTag(root);
    const returned = since === undefined ? "the version it held before this release" : taggedVersion(since);
    return yield* new TagRefused({
      message: `the build rewrites ${rebuilt.join(", ")} at ${head.slice(0, 12)}, which the release workflow's build check refuses; open a \`chore: cancel the unpublished ${version}\` pull request that returns ${MANIFEST} to ${returned} and commits what \`bun run build\` then writes to CHANGELOG.md, and the next ${cuttingWorkflow} run cuts the release again with every change since ${since ?? "the first commit"}`,
    });
  }
  yield* git(["push", "--quiet", "origin", `${head}:refs/tags/${tag}`], root);
  return true;
});

export const tagHead = Effect.fn("tagHead")(function* (
  label: string,
  root: string,
  workflow: string,
  cuttingWorkflow: string,
  awaitRelease?: (workflow: string, sha: string) => Effect.Effect<void, { readonly message: string }, ChildProcessSpawner.ChildProcessSpawner>,
) {
  const landed = yield* landedRelease(label, root);
  if (landed === undefined || !(yield* pushReleaseTag(label, root, landed, cuttingWorkflow))) return true;
  const { head, tag } = landed;
  yield* dispatch(workflow, tag).pipe(
    Effect.mapError(
      (failure) => new GitHubFailure({ message: `${failure.message}; ${tag} is pushed, so dispatch the release by hand with \`gh workflow run ${workflow} --ref ${tag}\`` }),
    ),
  );
  yield* Console.log(`${label}: tagged ${head.slice(0, 12)} as ${tag}, and dispatched ${workflow} on it`);
  if (awaitRelease !== undefined) {
    yield* awaitRelease(workflow, head);
    yield* Console.log(`${label}: ${workflow} finished on ${tag}`);
  }
  return true;
});

const existingRelease = Effect.fn("existingRelease")(function* (tag: string) {
  return yield* gitHubJson(decodeRelease, "GET", `${REPOSITORY}/releases/tags/${tag}`).pipe(
    Effect.map(({ id }) => Option.some(id)),
    Effect.catchIf(
      (failure) => failure.message.includes("(HTTP 404)"),
      () => Effect.succeed(Option.none<number>()),
    ),
  );
});

// A rerun finds the release a failed run made and rewrites its notes, so no tag ever holds two releases.
const writeGitHubRelease = Effect.fn("writeGitHubRelease")(function* (label: string, root: string, { version, tag }: Landed) {
  const changelog = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, "CHANGELOG.md"));
  const notes = yield* extractReleaseNotes(changelog, version);
  const release = { name: tag, body: notes, draft: false, prerelease: false };
  const existing = yield* existingRelease(tag);
  if (Option.isSome(existing)) {
    yield* gitHubJson(decodeRelease, "PATCH", `${REPOSITORY}/releases/${existing.value}`, release);
    yield* Console.log(`${label}: rewrote the notes of the GitHub release ${tag}`);
    return;
  }
  yield* gitHubJson(decodeRelease, "POST", `${REPOSITORY}/releases`, { tag_name: tag, ...release });
  yield* Console.log(`${label}: created the GitHub release ${tag} with the CHANGELOG.md section for ${version}`);
});

export const releaseHead = Effect.fn("releaseHead")(function* (label: string, root: string, cuttingWorkflow: string) {
  const landed = yield* landedRelease(label, root);
  if (landed === undefined) return true;
  yield* checkTestedTree(label, root, cuttingWorkflow);
  if (yield* pushReleaseTag(label, root, landed, cuttingWorkflow)) yield* Console.log(`${label}: tagged ${landed.head.slice(0, 12)} as ${landed.tag}`);
  yield* writeGitHubRelease(label, root, landed);
  if (!landed.publishes) {
    yield* Console.log(`${label}: ${MANIFEST} is private, so no package is published`);
    return true;
  }
  return yield* publishPackage(root);
});
