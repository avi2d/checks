import { Effect, Option, Schema } from "effect";
import { BaselineFailure, gh } from "./mutation-baseline-full.ts";

const WORKFLOW = "mutation.yml";
export const MAIN_BRANCH = "main";
const LATEST_LIMIT = 20;
const FULL_LIMIT = 50;
const PAGE_SIZE = 100;
const FULL_EVENTS = ["schedule", "workflow_dispatch"];

const Run = Schema.Struct({ databaseId: Schema.Int, event: Schema.String, createdAt: Schema.String });
export type Run = typeof Run.Type;

const Artifact = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  expired: Schema.Boolean,
  workflow_run: Schema.Struct({ id: Schema.Int, repository_id: Schema.Int, head_branch: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
});
export type Artifact = typeof Artifact.Type;

const decodeRun = Schema.decodeUnknownEffect(Schema.fromJsonString(Run));
const decodeRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Run)));
const decodeArtifacts = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ artifacts: Schema.Array(Artifact) })));

const listed = Effect.fn("listed")(function* (branch: string, event: string | undefined, limit: number) {
  const filter = event === undefined ? [] : ["--event", event];
  const args = ["run", "list", "--workflow", WORKFLOW, "--branch", branch, "--status", "success", ...filter, "--limit", String(limit), "--json", "databaseId,event,createdAt"];
  return yield* gh(args).pipe(
    Effect.flatMap(decodeRuns),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
  );
});

const byNewest = (runs: readonly Run[]): readonly Run[] => [...runs].sort((one, other) => other.createdAt.localeCompare(one.createdAt));

export function newestFirst(runs: readonly Run[]): readonly number[] {
  return byNewest(runs).map((run) => run.databaseId);
}

// Runs newer than the newest push hold no baseline, and a newer push without one supersedes every older baseline.
export function incrementalCandidates(runs: readonly Run[]): readonly Run[] {
  const ordered = byNewest(runs.filter((run) => run.event !== "pull_request"));
  const newestPush = ordered.findIndex((run) => run.event === "push");
  return newestPush === -1 ? ordered : ordered.slice(0, newestPush + 1);
}

export const latestCandidates = listed(MAIN_BRANCH, undefined, LATEST_LIMIT).pipe(Effect.map(incrementalCandidates));

export const latestRuns = latestCandidates.pipe(Effect.map((runs) => runs.map((run) => run.databaseId)));

// Each full event is listed on its own, because one shared window lets push runs crowd out every full run.
export const fullCandidates = Effect.fn("fullCandidates")(function* (branch: string) {
  const perEvent = yield* Effect.forEach(FULL_EVENTS, (event) => listed(branch, event, FULL_LIMIT));
  return byNewest(perEvent.flat());
});

// A full baseline supersedes every resume state before it, so only the runs newer than the run holding it can hold the state to resume from.
export function newerThan(runs: readonly number[], full: Option.Option<number>): readonly number[] {
  if (Option.isNone(full)) return runs;
  const at = runs.indexOf(full.value);
  return at === -1 ? runs : runs.slice(0, at);
}

export const viewedRun = Effect.fn("viewedRun")((id: string) =>
  gh(["run", "view", id, "--json", "databaseId,event,createdAt"]).pipe(
    Effect.flatMap(decodeRun),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
  ),
);

export const everyArtifact = Effect.fn("everyArtifact")(function* () {
  const artifacts: Artifact[] = [];
  let page = 1;
  while (true) {
    const batch = yield* gh(["api", `repos/{owner}/{repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`]).pipe(
      Effect.flatMap(decodeArtifacts),
      Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
    );
    artifacts.push(...batch.artifacts);
    if (batch.artifacts.length < PAGE_SIZE) return artifacts;
    page += 1;
  }
});

export const artifactOf = Effect.fn("artifactOf")(function* (run: number, name: string) {
  const found = yield* gh(["api", `repos/{owner}/{repo}/actions/runs/${run}/artifacts?name=${name}`]).pipe(
    Effect.flatMap(decodeArtifacts),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
  );
  return Option.fromNullishOr(found.artifacts.find((artifact) => artifact.name === name && !artifact.expired));
});
