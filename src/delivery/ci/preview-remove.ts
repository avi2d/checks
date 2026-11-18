import { Console, Effect } from "effect";
import { branchTargetFromEnv, removeBranch } from "./lib/cloudflare.ts";
import { editMarked, threadFromEnv } from "./lib/marker-comment.ts";

const ACTION = "preview-remove";

export function removedBody(count: number): string {
  return `Preview removed: the pull request closed and its ${count} deployment(s) on Cloudflare Pages were deleted.`;
}

export const main = Effect.gen(function* () {
  const { account, project, branch } = yield* branchTargetFromEnv(ACTION);
  const thread = yield* threadFromEnv(ACTION);
  const count = yield* removeBranch(account, project, branch);
  yield* Console.log(`deleted ${count} deployment(s) of ${branch}`);
  const edited = yield* editMarked(thread, removedBody(count));
  yield* Console.log(edited === "edited" ? "said on the pull request that the preview is gone" : "the pull request holds no preview comment to edit");
  return true;
});
