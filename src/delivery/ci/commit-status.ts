import { Config, Duration, Effect, Schema } from "effect";
import { STATUS_WAIT, reportStatus } from "./lib/commit-status.ts";
import { parseAttempts } from "./lib/retry.ts";
import { commandOutput } from "./lib/run.ts";

class HeadUnread extends Schema.TaggedError<HeadUnread>()("HeadUnread", {
  message: Schema.String,
}) {}

const optional = (name: string) => Config.String(name).pipe(Config.withDefault(""));

const FULL_SHA = /^[0-9a-f]{40}$/;

const pullRequestHead = Effect.fn("pullRequestHead")(function* (pullRequest: string, attempts: number) {
  if (!/^[1-9][0-9]*$/.test(pullRequest)) return yield* new HeadUnread({ message: `commit-status takes a pull request number, not '${pullRequest}'` });
  const repository = yield* Config.String("GITHUB_REPOSITORY");
  let sha = "";
  for (let attempt = 1; ; attempt += 1) {
    const read = yield* commandOutput("gh", ["api", `repos/${repository}/pulls/${pullRequest}`, "--jq", ".head.sha"]);
    sha = read.stdout.trim();
    if (read.passed && FULL_SHA.test(sha)) return sha;
    if (attempt >= attempts) break;
    yield* Effect.sleep(Duration.times(STATUS_WAIT, attempt));
  }
  return yield* new HeadUnread({ message: `commit-status cannot read the head of pull request ${pullRequest}: '${sha}'` });
});

export const main = Effect.gen(function* () {
  const request = yield* Config.all({
    outcome: optional("JOB_STATUS"),
    context: optional("CONTEXT"),
    headSha: optional("HEAD_SHA"),
    description: optional("DESCRIPTION"),
  });
  const tries = yield* parseAttempts(yield* Config.String("ATTEMPTS").pipe(Config.withDefault("1")));
  const pullRequest = yield* optional("PULL_REQUEST");
  const headSha = request.headSha === "" && pullRequest !== "" ? yield* pullRequestHead(pullRequest, tries) : request.headSha;
  return yield* reportStatus({ ...request, headSha, attempts: tries });
});
