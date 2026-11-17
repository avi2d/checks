import { Console, Effect, Schema } from "effect";
import { accountFromEnv, servedCommit } from "./lib/cloudflare.ts";
import { github, repositoryFromEnv } from "./lib/github.ts";
import { requiredInput } from "./lib/inputs.ts";
import { writeOutputs } from "./lib/step-output.ts";

const ACTION = "pages-staged-commit";

class NotStaged extends Schema.TaggedError<NotStaged>()("NotStaged", {
  message: Schema.String,
}) {}

const Commit = Schema.Struct({ sha: Schema.String });
const Comparison = Schema.Struct({ status: Schema.String });
const Runs = Schema.Struct({ total_count: Schema.Finite });

// main...commit reads identical or behind exactly when the commit is main's tip or one of its ancestors.
export function isOnBranch(status: string): boolean {
  return status === "identical" || status === "behind";
}

export const main = Effect.gen(function* () {
  yield* requiredInput(ACTION, "deploy-key", "DEPLOY_KEY");
  const account = yield* accountFromEnv(ACTION);
  const repository = yield* repositoryFromEnv(ACTION);
  const project = yield* requiredInput(ACTION, "project", "PROJECT");
  const branch = yield* requiredInput(ACTION, "branch", "BRANCH");
  const workflow = yield* requiredInput(ACTION, "workflow", "WORKFLOW");
  const served = yield* servedCommit(account, project);
  const { sha } = yield* github(repository, Commit, "GET", `/commits/${encodeURIComponent(served)}`);
  const { status } = yield* github(repository, Comparison, "GET", `/compare/${encodeURIComponent(branch)}...${sha}`);
  if (!isOnBranch(status)) return yield* new NotStaged({ message: `the Pages project ${project} serves ${sha}, which is not on ${branch}` });
  const runs = yield* github(repository, Runs, "GET", `/actions/workflows/${encodeURIComponent(workflow)}/runs?head_sha=${sha}&status=success`);
  if (runs.total_count === 0) return yield* new NotStaged({ message: `no green ${workflow} run has deployed ${sha}` });
  yield* Console.log(`the Pages project ${project} serves ${branch} ${sha}`);
  yield* writeOutputs({ sha });
  return true;
});
