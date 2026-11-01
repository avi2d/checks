#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { dispatch, gitHubJson, REPOSITORY } from "./github.ts";
import { releaseTitle, runningWorkflow } from "./release.ts";
import { buildRelease, commitRelease, hasBranch, MANIFEST, planRelease, pointBranch, versionIn } from "./release-commit.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

type Remote = {
  readonly parents: readonly string[];
  readonly version: string | undefined;
};

const NAME = "checks-release-pr";
const USAGE = "usage: release-pr.ts <workflow>...";

const PullRequest = Schema.Struct({ number: Schema.Int, title: Schema.String, html_url: Schema.String });
type PullRequest = typeof PullRequest.Type;
const decodePullRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequest));
const decodePullRequests = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(PullRequest)));

const readRemote = Effect.fn("readRemote")(function* (root: string, branch: string) {
  if (!(yield* hasBranch(root, branch))) return undefined;
  const tracking = `refs/remotes/origin/${branch}`;
  yield* git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:${tracking}`], root);
  const [, ...parents] = (yield* git(["rev-list", "--parents", "-n", "1", tracking], root)).trim().split(" ");
  const version = yield* git(["show", `${tracking}:${MANIFEST}`], root).pipe(
    Effect.flatMap(versionIn),
    Effect.orElseSucceed(() => undefined),
  );
  return { parents, version } satisfies Remote;
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
  const untagged = `rerun the tag job of ${yield* runningWorkflow} on the release commit, whose refusal says what to fix`;
  const plan = yield* planRelease("release-pr", root, untagged);
  if (plan === undefined) return true;
  const { base, branch, head, next, bumped } = plan;
  const remote = yield* readRemote(root, branch);
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
