#!/usr/bin/env bun
import { Console, Duration, Effect, Schema } from "effect";
import { dispatch, gitHubJson, REPOSITORY } from "./github.ts";
import { releasedVersionOf } from "./release.ts";
import { buildRelease, commitRelease, decodeRef, hasBranch, planRelease, pointBranch, refused } from "./release-commit.ts";
import { pushTag, tagHead, taggedOn } from "./release-tagging.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const NAME = "checks-release-push";
const LABEL = "release-push";
const USAGE = "usage: release-push.ts <release-workflow> <workflow>...";
const UNTAGGED = "tag the release commit with checks-release-tag, whose refusal says what to fix";
const POLL = Duration.seconds(15);
const POLLS = 180;

const Run = Schema.Struct({ path: Schema.String, status: Schema.String, conclusion: Schema.NullOr(Schema.String), html_url: Schema.String });
type Run = typeof Run.Type;
const decodeRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ workflow_runs: Schema.Array(Run) })));

export type Verdict =
  | { readonly kind: "pending"; readonly waiting: readonly string[] }
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly failed: readonly string[] };

// GitHub lists the newest run first, so a rerun stands in for the run it repeats.
export function verdictOf(workflows: readonly string[], runs: readonly Run[]): Verdict {
  const latest = workflows.map((workflow) => {
    const path = `.github/workflows/${workflow}`;
    return { workflow, run: runs.find((run) => run.path === path || run.path.startsWith(`${path}@`)) };
  });
  const failed = latest.flatMap(({ workflow, run }) =>
    run?.status === "completed" && run.conclusion !== "success" ? [`${workflow} concluded ${run.conclusion ?? "with no conclusion"} at ${run.html_url}`] : [],
  );
  if (failed.length > 0) return { kind: "failed", failed };
  const waiting = latest.flatMap(({ workflow, run }) => (run?.status === "completed" ? [] : [workflow]));
  return waiting.length > 0 ? { kind: "pending", waiting } : { kind: "passed" };
}

const awaitChecks = Effect.fn("awaitChecks")(function* (workflows: readonly string[], sha: string) {
  const runs = `${REPOSITORY}/actions/runs?head_sha=${sha}&event=workflow_dispatch&per_page=100`;
  let waiting = workflows;
  for (let poll = 1; poll <= POLLS; poll += 1) {
    const verdict = verdictOf(workflows, (yield* gitHubJson(decodeRuns, "GET", runs)).workflow_runs);
    if (verdict.kind === "passed") return;
    if (verdict.kind === "failed") return yield* refused(`the checks failed on ${sha.slice(0, 12)}, so the release stays off the branch: ${verdict.failed.join(", ")}`);
    waiting = verdict.waiting;
    yield* Effect.sleep(POLL);
  }
  return yield* refused(`${waiting.join(", ")} did not finish on ${sha.slice(0, 12)} within ${Duration.format(Duration.times(POLL, POLLS))}, so the release stays off the branch`);
});

type Landing = "landed" | "moved";

// GitHub refuses a branch update that is no fast-forward, which is how a branch that moved during the checks shows.
// A failed call may still have applied the update, so the branch's head decides what happened.
const land = Effect.fn("land")(function* (root: string, base: string, head: string, release: string) {
  return yield* gitHubJson(decodeRef, "PATCH", `${REPOSITORY}/git/refs/heads/${base}`, { sha: release, force: false }).pipe(
    Effect.as<Landing>("landed"),
    Effect.catchTag("GitHubFailure", (failure) =>
      git(["ls-remote", "origin", `refs/heads/${base}`], root).pipe(
        Effect.flatMap((listed) =>
          Effect.gen(function* () {
            const now = listed.split("\t")[0];
            if (now === release) return "landed" as Landing;
            if (now === head) return yield* Effect.fail(failure);
            yield* git(["fetch", "--quiet", "--no-tags", "origin", `refs/heads/${base}`], root);
            const ancestor = yield* git(["merge-base", "--is-ancestor", release, "FETCH_HEAD"], root).pipe(
              Effect.as(true),
              Effect.catchTag("GitFailure", () => Effect.succeed(false)),
            );
            return (ancestor ? "landed" : "moved") as Landing;
          }),
        ),
      ),
    ),
  );
});

const releasePush = Effect.gen(function* () {
  const [publish, ...checks] = process.argv.slice(2);
  if (publish === undefined || checks.length === 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if (releasedVersionOf((yield* git(["log", "-1", "--format=%s", "HEAD"], root)).trim()) !== undefined) return yield* tagHead(LABEL, root, publish, LABEL);
  const plan = yield* planRelease(LABEL, root, UNTAGGED);
  if (plan === undefined) return true;
  const { base, branch, head, next, bumped } = plan;
  const tag = `v${next}`;
  const taken = yield* taggedOn(root, tag);
  if (taken !== undefined) return yield* refused(`${tag} already tags ${taken.slice(0, 12)}, so ${next} cannot be released again`);
  const release = yield* commitRelease(root, head, yield* buildRelease(NAME, root, bumped), next);
  yield* pointBranch(branch, release, yield* hasBranch(root, branch));
  yield* Effect.forEach(checks, (workflow) => dispatch(workflow, branch));
  yield* Console.log(`${LABEL}: dispatched ${checks.join(", ")} on ${branch} to check ${next} at ${release.slice(0, 12)}`);
  yield* awaitChecks(checks, release);
  if ((yield* land(root, base, head, release)) === "moved") {
    yield* Console.log(`${LABEL}: ${base} moved past ${head.slice(0, 12)} while the checks ran, so the run on its new head releases it`);
    return true;
  }
  // The release commit exists only on GitHub, and pushing the tag needs it in the checkout.
  yield* git(["fetch", "--quiet", "--no-tags", "origin", `refs/heads/${base}`], root);
  yield* pushTag(root, release, tag, publish);
  yield* Console.log(`${LABEL}: released ${next} as ${release.slice(0, 12)} on ${base}, tagged it ${tag}, and dispatched ${publish} on it`);
  return true;
});

if (import.meta.main) runMain(NAME, releasePush);
