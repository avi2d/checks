import { Console, Duration, Effect, Option, Schema } from "effect";
import { github, githubDelete, repositoryFromEnv, type Repository } from "./lib/github.ts";
import { requiredInput } from "./lib/inputs.ts";

const ACTION = "held-runs";
const READ_EVERY_SECONDS = 5;
const WAIT_SECONDS = 30;

const Ref = Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) });

const Run = Schema.Struct({
  id: Schema.Finite,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  event: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  head_sha: Schema.String,
  head_branch: Schema.NullOr(Schema.String),
  head_repository: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
});

export type Run = typeof Run.Type;

const Runs = Schema.Struct({ workflow_runs: Schema.Array(Run) });

type Head = { readonly repository: string; readonly branch: string; readonly sha: string };

// A held run has no job, so the conclusion is what tells it from a run that has jobs.
export function heldOn(runs: readonly Run[], head: Head): Run[] {
  return runs.filter(
    (run) =>
      run.event === "pull_request" &&
      run.conclusion === "action_required" &&
      run.head_sha === head.sha &&
      run.head_branch === head.branch &&
      run.head_repository?.full_name === head.repository,
  );
}

// deleteFound answers how many runs that read deleted.
export const sweep = <E, R>(deleteFound: Effect.Effect<number, E, R>, waitSeconds: number): Effect.Effect<number, E, R> =>
  Effect.gen(function* () {
    let deleted = 0;
    for (let waited = 0; ; waited += READ_EVERY_SECONDS) {
      const found = yield* deleteFound;
      deleted += found;
      if (found === 0 && (deleted > 0 || waited >= waitSeconds)) return deleted;
      yield* Effect.sleep(Duration.seconds(READ_EVERY_SECONDS));
    }
  });

const readTip = (repository: Repository, branch: string) =>
  github(repository, Ref, "GET", `/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`).pipe(
    Effect.map((ref) => Option.some(ref.object.sha)),
    Effect.catchIf(
      (error) => error.status === 404,
      () => Effect.succeedNone,
    ),
  );

export const main = Effect.gen(function* () {
  const repository = yield* repositoryFromEnv(ACTION);
  const branch = yield* requiredInput(ACTION, "branch", "BRANCH");
  const tip = yield* readTip(repository, branch);
  if (Option.isNone(tip)) {
    yield* Console.log(`${branch} does not exist, so no run is held on it`);
    return true;
  }
  const sha = tip.value;
  const head: Head = { repository: repository.name, branch, sha };
  // GitHub can list a run for a moment after its delete, and a second delete of it answers 404.
  const gone = new Set<number>();
  const deleteFound = Effect.gen(function* () {
    const listed = yield* github(repository, Runs, "GET", `/actions/runs?head_sha=${sha}&event=pull_request&status=action_required&per_page=100`);
    const held = heldOn(listed.workflow_runs, head).filter((run) => !gone.has(run.id));
    for (const run of held) {
      yield* githubDelete(repository, `/actions/runs/${run.id}`);
      gone.add(run.id);
      yield* Console.log(`deleted the held ${run.name ?? "unnamed"} run ${run.id} on ${branch} at ${sha}`);
    }
    return held.length;
  });
  const deleted = yield* sweep(deleteFound, WAIT_SECONDS);
  if (deleted === 0) yield* Console.log(`found no held pull request run on ${branch} at ${sha} within ${WAIT_SECONDS} seconds`);
  return true;
});
