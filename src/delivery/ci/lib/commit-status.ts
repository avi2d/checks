import { Config, Duration, Effect } from "effect";
import { parseAttempts, retryWithGrowingWait } from "./retry.ts";
import { commandPasses } from "./run.ts";

export type State = "success" | "failure";

export function stateOf(outcome: string): State {
  return outcome === "success" ? "success" : "failure";
}

export type CommitStatus = {
  readonly repository: string;
  readonly sha: string;
  readonly state: State;
  readonly context: string;
  readonly description: string;
  readonly targetUrl: string;
};

export function statusArgs({ repository, sha, state, context, description, targetUrl }: CommitStatus): readonly string[] {
  return [
    "api",
    `repos/${repository}/statuses/${sha}`,
    "-f",
    `state=${state}`,
    "-f",
    `context=${context}`,
    ...(description === "" ? [] : ["-f", `description=${description}`]),
    "-f",
    `target_url=${targetUrl}`,
    "--silent",
  ];
}

export type StatusRequest = {
  readonly outcome: string;
  readonly context: string;
  readonly headSha: string;
  readonly description: string;
  readonly attempts: string;
};

export const STATUS_WAIT = Duration.seconds(10);

export const reportStatus = Effect.fn("reportStatus")(function* ({ outcome, context, headSha, description, attempts }: StatusRequest) {
  const tries = yield* parseAttempts(attempts);
  const run = yield* Config.all({
    repository: Config.String("GITHUB_REPOSITORY"),
    sha: Config.String("GITHUB_SHA"),
    server: Config.String("GITHUB_SERVER_URL"),
    runId: Config.String("GITHUB_RUN_ID"),
  });
  const status: CommitStatus = {
    repository: run.repository,
    sha: headSha === "" ? run.sha : headSha,
    state: stateOf(outcome),
    context,
    description,
    targetUrl: `${run.server}/${run.repository}/actions/runs/${run.runId}`,
  };
  return yield* retryWithGrowingWait(commandPasses("gh", statusArgs(status)), { attempts: tries, wait: STATUS_WAIT, onRetry: () => Effect.void });
});
