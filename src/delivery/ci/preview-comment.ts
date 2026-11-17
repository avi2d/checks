import { Console, Effect } from "effect";
import { requiredInput } from "./lib/inputs.ts";
import { threadFromEnv, writeMarked } from "./lib/marker-comment.ts";

const ACTION = "preview-comment";

export function previewBody(headSha: string, origin: string): string {
  return `Preview of \`${headSha.slice(0, 7)}\`: ${origin}/`;
}

export const main = Effect.gen(function* () {
  const thread = yield* threadFromEnv(ACTION);
  const origin = yield* requiredInput(ACTION, "origin", "ORIGIN");
  const headSha = yield* requiredInput(ACTION, "head-sha", "HEAD_SHA");
  const written = yield* writeMarked(thread, previewBody(headSha, origin));
  yield* Console.log(`${written} the preview comment on pull request ${thread.pullRequest}`);
  return true;
});
