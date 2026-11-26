import { Effect } from "effect";
import { git } from "../core/git.ts";

export const CHANGELOG = "CHANGELOG.md";

export const committedChangelog = Effect.fn("committedChangelog")(function* (root: string, revision: string) {
  const type = yield* git(["cat-file", "-t", `${revision}:${CHANGELOG}`], root).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));
  return type.trim() === "blob";
});
