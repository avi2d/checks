#!/usr/bin/env bun
import { Console, Effect, Option, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { dispatch, gitHubJson, gitHubOptional, REPOSITORY } from "../core/github.ts";
import { releaseTitle, runningWorkflow } from "./release.ts";
import { buildRelease, commitRelease, planRelease, pointBranch, versionIn } from "./release-commit.ts";
import { git } from "../core/git.ts";
import { MANIFEST } from "../core/release-names.ts";
import { runMain, Usage } from "../core/main.ts";

type Remote = {
  readonly parents: readonly string[];
  readonly version: string | undefined;
};

const NAME = "checks-release-pr";
const USAGE = "usage: checks-release-pr [--allow-non-default-branch] <workflow>...";

const PullRequest = Schema.Struct({ number: Schema.Int, title: Schema.String, html_url: Schema.String });
type PullRequest = typeof PullRequest.Type;
const decodePullRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequest));
const decodePullRequests = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(PullRequest)));
const decodeRepository = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ default_branch: Schema.String })));

const decodeRef = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) })));
const decodeCommit = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ parents: Schema.Array(Schema.Struct({ sha: Schema.String })) })));
const decodeContent = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ content: Schema.String, encoding: Schema.Literal("base64") })));

const readRemote = Effect.fn("readRemote")(function* (branch: string) {
  const ref = yield* gitHubOptional(decodeRef, "GET", `${REPOSITORY}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (Option.isNone(ref)) return undefined;
  const sha = ref.value.object.sha;
  const commit = yield* gitHubJson(decodeCommit, "GET", `${REPOSITORY}/git/commits/${sha}`);
  const content = yield* gitHubOptional(decodeContent, "GET", `${REPOSITORY}/contents/${MANIFEST}?ref=${sha}`);
  const version = Option.isNone(content) ? undefined : yield* Effect.fromResult(Base64.decode(content.value.content.replaceAll("\n", ""))).pipe(
    Effect.flatMap((bytes) => versionIn(new TextDecoder().decode(bytes))),
    Effect.orElseSucceed(() => undefined),
  );
  return { parents: commit.parents.map((parent) => parent.sha), version } satisfies Remote;
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
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    yield* Console.log(USAGE);
    return true;
  }
  const allowNonDefault = args.includes("--allow-non-default-branch");
  const workflows = args.filter((arg) => arg !== "--allow-non-default-branch");
  if (workflows.length === 0 || workflows.some((arg) => arg.startsWith("-"))) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if (!allowNonDefault) {
    const branch = (yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"], root)).trim();
    const { default_branch } = yield* gitHubJson(decodeRepository, "GET", REPOSITORY);
    if (branch !== default_branch) return yield* new Usage({ message: `branch ${branch} is not the default branch ${default_branch}; pass --allow-non-default-branch to release from it` });
  }
  const untagged = `rerun the tag job of ${yield* runningWorkflow} on the release commit, whose refusal says what to fix`;
  const plan = yield* planRelease("release-pr", root, untagged);
  if (plan === undefined) return true;
  const { base, branch, head, next, bumped } = plan;
  const remote = yield* readRemote(branch);
  const current = remote?.version === next && remote.parents.length === 1 && remote.parents[0] === head;
  const open = yield* findOpen(base, branch);
  if (current && open?.title === releaseTitle(next)) {
    yield* Console.log(`release-pr: ${open.html_url} releases ${next} from ${head.slice(0, 12)} and is current`);
    return true;
  }
  if (!current) yield* pointBranch(branch, yield* commitRelease(root, head, yield* buildRelease(NAME, root, bumped), next), remote !== undefined);
  const { verb, url } = yield* titlePullRequest(open, base, branch, next);
  yield* Effect.forEach(workflows, (workflow) => dispatch(workflow, branch));
  yield* Console.log(`release-pr: ${verb} ${url} to release ${next}, and dispatched ${workflows.join(", ")} on ${branch}`);
  return true;
});

if (import.meta.main) runMain(NAME, releasePullRequest);
