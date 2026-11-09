import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { dispatch, GitHubFailure, gitHubJson, REPOSITORY } from "../core/github.ts";
import { ChildProcessSpawner } from "effect/process";
import { lastTag, pullNumberOf, releasedVersionOf, releaseTitle, runBuild } from "./release.ts";
import { git } from "../core/git.ts";
import { MANIFEST, releaseTag, taggedVersion } from "../core/release-names.ts";

class TagRefused extends Schema.TaggedError<TagRefused>()("TagRefused", {
  message: Schema.String,
}) {}


const decodeVersion = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

const decodeTestedPullRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String, head: Schema.Struct({ sha: Schema.String }) })),
);

// An annotated tag lists its own object first and the commit it tags on a `^{}` line after it.
export function taggedCommitOf(listed: string): string | undefined {
  const lines = listed.split("\n").filter((line) => line !== "");
  const peeled = lines.find((line) => line.endsWith("^{}")) ?? lines[0];
  return peeled?.split("\t")[0];
}

const taggedOn = Effect.fn("taggedOn")(function* (root: string, tag: string) {
  return taggedCommitOf(yield* git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root));
});

const treeOf = Effect.fn("treeOf")(function* (root: string, sha: string) {
  return (yield* git(["rev-parse", `${sha}^{tree}`], root)).trim();
});

const pushTag = Effect.fn("pushTag")(function* (root: string, sha: string, tag: string, workflow: string, note: string) {
  yield* git(
    [
      "-c", "user.name=github-actions[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "tag", "-a", "-m", note, tag, sha,
    ],
    root,
  );
  yield* git(["push", "--quiet", "origin", `refs/tags/${tag}`], root);
  yield* dispatch(workflow, tag).pipe(
    Effect.mapError(
      (failure) => new GitHubFailure({ message: `${failure.message}; ${tag} is pushed, so dispatch the release by hand with \`gh workflow run ${workflow} --ref ${tag}\`` }),
    ),
  );
});

export const tagHead = Effect.fn("tagHead")(function* (
  label: string,
  root: string,
  workflow: string,
  cuttingWorkflow: string,
  awaitRelease?: (workflow: string, sha: string) => Effect.Effect<void, { readonly message: string }, ChildProcessSpawner.ChildProcessSpawner>,
) {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const version = releasedVersionOf(subject);
  if (version === undefined) {
    yield* Console.log(`${label}: ${head.slice(0, 12)} is no release commit`);
    return true;
  }
  const manifest = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const { version: held } = yield* decodeVersion(manifest).pipe(Effect.mapError((cause) => new TagRefused({ message: `${MANIFEST}: ${cause.message}` })));
  if (held !== version) return yield* new TagRefused({ message: `${head.slice(0, 12)} releases ${version}, but ${MANIFEST} holds ${held}` });
  const tag = releaseTag(version);
  const tagged = yield* taggedOn(root, tag);
  if (tagged === head) {
    yield* Console.log(`${label}: ${tag} already tags ${head.slice(0, 12)}`);
    return true;
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
  const pull = pullNumberOf(subject);
  if (pull === undefined) {
    return yield* new TagRefused({ message: `${head.slice(0, 12)} names no pull request, so no release pull request tested it; merge the release pull request to land the release, and tag nothing by hand` });
  }
  const tested = yield* gitHubJson(decodeTestedPullRequest, "GET", `${REPOSITORY}/pulls/${pull}`);
  if (tested.title !== releaseTitle(version)) {
    return yield* new TagRefused({ message: `pull request #${pull} is ${tested.title}, not ${releaseTitle(version)}, so it never tested ${head.slice(0, 12)}; merge the release pull request to land the release, and tag nothing by hand` });
  }
  const [landed, expected] = yield* Effect.all([treeOf(root, head), treeOf(root, tested.head.sha)], { concurrency: 2 });
  if (landed !== expected) {
    const since = yield* lastTag(root);
    const returned = since === undefined ? "the version it held before this release" : taggedVersion(since);
    return yield* new TagRefused({
      message: `${head.slice(0, 12)} differs from the tree ${tested.head.sha.slice(0, 12)} the release pull request tested, so main moved after the full run; open a \`chore: cancel the unpublished ${version}\` pull request that returns ${MANIFEST} to ${returned} and commits what \`bun run build\` then writes to CHANGELOG.md, and the next ${cuttingWorkflow} run cuts the release again with every change since ${since ?? "the first commit"}`,
    });
  }
  yield* pushTag(root, head, tag, workflow, `Release ${version} tested by pull request #${pull} at ${tested.head.sha}\n\nTested-Tree: ${landed}`);
  yield* Console.log(`${label}: tagged ${head.slice(0, 12)} as ${tag}, and dispatched ${workflow} on it`);
  if (awaitRelease !== undefined) {
    yield* awaitRelease(workflow, head);
    yield* Console.log(`${label}: ${workflow} finished on ${tag}`);
  }
  return true;
});
