import { Config, Console, Duration, Effect } from "effect";
import { commandOutput } from "./lib/run.ts";

type Run = { readonly event: string; readonly draft: string; readonly attempt: string };

export function holdReason({ event, draft, attempt }: Run): string | undefined {
  if (event !== "pull_request" && event !== "pull_request_target") return `a ${event} run is no push to a draft`;
  if (draft !== "true") return "the pull request is ready for review";
  if (attempt !== "1") return `someone started attempt ${attempt} of this run by hand`;
  return undefined;
}

const optional = (name: string) => Config.String(name).pipe(Config.withDefault(""));

export const main = Effect.gen(function* () {
  const run = yield* Config.all({ event: optional("GITHUB_EVENT_NAME"), draft: optional("DRAFT"), attempt: optional("GITHUB_RUN_ATTEMPT") });
  const reason = holdReason(run);
  if (reason !== undefined) {
    yield* Console.log(`draft-hold: ${reason}, so the checks run`);
    return true;
  }
  const repository = yield* Config.String("GITHUB_REPOSITORY");
  const runId = yield* Config.String("GITHUB_RUN_ID");
  // A cancelled check stays unmet, and a skipped one would read as passed.
  const cancel = yield* commandOutput("gh", ["api", "--method", "POST", `repos/${repository}/actions/runs/${runId}/cancel`]);
  if (!cancel.passed) {
    yield* Console.log("::warning::draft-hold could not cancel this run, so the checks run. Give the job actions: write to hold a draft's checks.");
    return true;
  }
  yield* Console.log("::notice::The pull request is a draft, so its checks wait. Re-run this run to start them by hand, or mark the pull request ready for review.");
  yield* Effect.sleep(Duration.seconds(yield* Config.Int("WAIT_SECONDS").pipe(Config.withDefault(30))));
  // GitHub never stops a job whose if: is always(), so the hold fails it in place of a pass.
  yield* Console.log("::error::The pull request is a draft and this job outlived the cancel of its run, so the job fails. Re-run this run to start the checks by hand.");
  return false;
});
