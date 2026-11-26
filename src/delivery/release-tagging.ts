import { Config, Console, Effect, Option, Path, Schema } from "effect";
import { dispatch, GitHubFailure, gitHubJson, gitHubOptional, REPOSITORY } from "../core/github.ts";
import { ChildProcessSpawner } from "effect/process";
import { lastTag, runBuild } from "./release.ts";
import { extractReleaseNotes } from "./release-notes.ts";
import { publishPackage } from "./release-publish.ts";
import { publishConfiguredPlatformPackages } from "./platform-packages.ts";
import { checkTestedTreeOf } from "./tested-tree.ts";
import { collect, git } from "../core/git.ts";
import { MANIFEST, releasedVersionOf, releaseTag, taggedVersion } from "../core/release-names.ts";
import { publicWorkspaces } from "./workspace-packages.ts";
import { writeOutputs } from "./ci/lib/step-output.ts";

class TagRefused extends Schema.TaggedError<TagRefused>()("TagRefused", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String, private: Schema.optionalKey(Schema.Boolean) })));
const decodeRelease = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ id: Schema.Int })));

const decodeObject = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ object: Schema.Struct({ sha: Schema.String, type: Schema.String }) })));

export const taggedOn = Effect.fn("taggedOn")(function* (tag: string) {
  const ref = yield* gitHubOptional(decodeObject, "GET", `${REPOSITORY}/git/ref/tags/${encodeURIComponent(tag)}`);
  if (Option.isNone(ref)) return undefined;
  let object = ref.value.object;
  while (object.type === "tag") {
    object = (yield* gitHubJson(decodeObject, "GET", `${REPOSITORY}/git/tags/${object.sha}`)).object;
  }
  return object.sha;
});

type Landed = { readonly head: string; readonly subject: string; readonly version: string; readonly tag: string; readonly publishes: boolean };

const manifestAt = Effect.fn("manifestAt")(function* (root: string, head: string) {
  const text = yield* git(["show", `${head}:${MANIFEST}`], root).pipe(Effect.mapError(() => new TagRefused({ message: `${head.slice(0, 12)} holds no ${MANIFEST}` })));
  return yield* decodeManifest(text).pipe(Effect.mapError((cause) => new TagRefused({ message: `${MANIFEST}: ${cause.message}` })));
});

const landedOf = Effect.fn("landedOf")(function* (root: string, head: string, subject: string) {
  const version = releasedVersionOf(subject);
  if (version === undefined) return undefined;
  const held = yield* manifestAt(root, head);
  if (held.version !== version) return yield* new TagRefused({ message: `${head.slice(0, 12)} releases ${version}, but ${MANIFEST} holds ${held.version}` });
  return { head, subject, version, tag: releaseTag(version), publishes: held.private !== true } satisfies Landed;
});

const landedHead = Effect.fn("landedHead")(function* (label: string, root: string) {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const landed = yield* landedOf(root, head, subject);
  if (landed !== undefined) return landed;
  yield* Console.log(`${label}: ${head.slice(0, 12)} is no release commit`);
  return undefined;
});

const landedRelease = Effect.fn("landedRelease")(function* (label: string, root: string) {
  const [head = "", subject = ""] = (yield* git(["log", "-1", "--format=%H%n%s", "HEAD"], root)).split("\n");
  const landed = yield* landedOf(root, head, subject);
  if (landed !== undefined) return landed;
  const held = yield* manifestAt(root, head).pipe(Effect.option);
  if (Option.isNone(held)) {
    yield* Console.log(`${label}: ${head.slice(0, 12)} is no release commit`);
    return undefined;
  }
  const history = (yield* git(["log", "--first-parent", "--format=%H %s", "HEAD"], root)).split("\n").filter((line) => line !== "").slice(1);
  for (const line of history) {
    const sha = line.slice(0, 40);
    const candidate = yield* landedOf(root, sha, line.slice(41));
    if (candidate === undefined) continue;
    if (candidate.version !== held.value.version) break;
    if ((yield* taggedOn(candidate.tag)) === sha) break;
    return candidate;
  }
  yield* Console.log(`${label}: ${head.slice(0, 12)} is no release commit; a release whose GitHub release or npm publish failed is finished by rerunning that release commit's own main run`);
  return undefined;
});

// Returns false when the tag already tags the head, so a rerun pushes nothing.
const pushReleaseTag = Effect.fn("pushReleaseTag")(function* (label: string, root: string, { head, version, tag }: Landed, cuttingWorkflow: string) {
  const tagged = yield* taggedOn(tag);
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
  const landed = yield* landedHead(label, root);
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
  const release = yield* gitHubOptional(decodeRelease, "GET", `${REPOSITORY}/releases/tags/${tag}`);
  return Option.map(release, ({ id }) => id);
});

// A rerun finds the release a failed run made and rewrites its notes, so no tag ever holds two releases.
const writeGitHubRelease = Effect.fn("writeGitHubRelease")(function* (label: string, root: string, { head, version, tag }: Landed) {
  const changelog = yield* git(["show", `${head}:CHANGELOG.md`], root).pipe(Effect.mapError(() => new TagRefused({ message: `${head.slice(0, 12)} holds no CHANGELOG.md` })));
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

const writeReleasedTagOutput = Effect.fn("writeReleasedTagOutput")(function* (tag: string) {
  if ((yield* Config.String("GITHUB_OUTPUT").pipe(Config.withDefault(""))) === "") return;
  yield* writeOutputs({ tag });
});

const checkoutRelease = Effect.fn("checkoutRelease")(function* (root: string, head: string) {
  const current = (yield* git(["rev-parse", "HEAD"], root)).trim();
  if (current === head) return;
  const dirty = (yield* git(["status", "--porcelain"], root)).trim();
  if (dirty !== "") {
    return yield* new TagRefused({ message: `${head.slice(0, 12)} sits behind ${current.slice(0, 12)}, but the checkout holds uncommitted changes, so commit or discard them and run again` });
  }
  yield* git(["checkout", "--quiet", "--detach", head], root);
  const installed = yield* collect("bun", ["install", "--frozen-lockfile"], root).pipe(
    Effect.mapError((cause) => new TagRefused({ message: `bun install --frozen-lockfile: ${cause.message}` })),
  );
  if (installed.exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new TagRefused({ message: `bun install --frozen-lockfile exited ${installed.exitCode} at ${head.slice(0, 12)}: ${installed.stderr.trim()}` });
  }
});

export const releaseHead = Effect.fn("releaseHead")(function* (label: string, root: string, cuttingWorkflow: string) {
  const landed = yield* landedRelease(label, root);
  if (landed === undefined) return true;
  yield* checkoutRelease(root, landed.head);
  yield* checkTestedTreeOf(label, root, cuttingWorkflow, landed.head, landed.subject);
  const publishWorkspaces = (yield* Config.String("CHECKS_PUBLISH_WORKSPACES").pipe(Config.withDefault("false"))) === "true";
  const workspaces = !landed.publishes && publishWorkspaces ? yield* publicWorkspaces(root) : [];
  for (const workspace of workspaces) {
    if (workspace.version !== landed.version) return yield* new TagRefused({ message: `${workspace.path} holds ${workspace.version}, not the tested release version ${landed.version}` });
  }
  const tagged = yield* pushReleaseTag(label, root, landed, cuttingWorkflow);
  if (tagged) yield* Console.log(`${label}: tagged ${landed.head.slice(0, 12)} as ${landed.tag}`);
  if (!tagged && (landed.publishes || workspaces.length > 0)) yield* runBuild(root);
  yield* writeGitHubRelease(label, root, landed);
  yield* writeReleasedTagOutput(landed.tag);
  if (!landed.publishes) {
    if (workspaces.length === 0) yield* Console.log(`${label}: ${MANIFEST} is private, so no package is published`);
    const path = yield* Path.Path;
    for (const workspace of workspaces) yield* publishPackage(path.dirname(path.join(root, workspace.path)));
    return true;
  }
  yield* publishConfiguredPlatformPackages(root);
  return yield* publishPackage(root);
});
