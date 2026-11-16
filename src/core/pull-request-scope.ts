import { Config, Effect, FileSystem } from "effect";
import { pathsSinceMergeBase } from "./git.ts";
import { decodePullRequestEvent, pullRequestEndsOf } from "./lint.ts";
import { releasedVersionOf } from "./release-names.ts";

export type RunScope =
  | { readonly kind: "whole"; readonly because: string }
  | { readonly kind: "docs-only"; readonly changed: readonly string[] }
  | { readonly kind: "pull-request"; readonly changed: readonly string[]; readonly ends?: { readonly base: string; readonly head: string } };

export function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") && (!lower.includes("/") || lower.startsWith("docs/"));
}



const eventOf = Config.all({
  name: Config.String("GITHUB_EVENT_NAME").pipe(Config.withDefault("")),
  path: Config.String("GITHUB_EVENT_PATH").pipe(Config.withDefault("")),
});

export function scopeOfChanges(title: string, changed: readonly string[]): RunScope {
  if (releasedVersionOf(title) !== undefined) return { kind: "whole", because: "the pull request is a release" };
  if (changed.length > 0 && changed.every(isDocsPath)) return { kind: "docs-only", changed };
  return { kind: "pull-request", changed };
}

export function scopeOfEvent(name: string): RunScope | undefined {
  if (name === "pull_request") return undefined;
  return { kind: "whole", because: name === "" ? "the run is no pull request" : `the run is ${name}, not a pull request` };
}

export const readRunScope = Effect.fn("readRunScope")(function* (root: string) {
  const event = yield* eventOf.pipe(Effect.orElseSucceed(() => ({ name: "", path: "" })));
  const outside = scopeOfEvent(event.name);
  if (outside !== undefined) return outside;
  const scope = Effect.gen(function* () {
    const { pull_request: pullRequest } = yield* decodePullRequestEvent(yield* (yield* FileSystem.FileSystem).readFileString(event.path));
    const ends = pullRequestEndsOf(pullRequest);
    const selected = scopeOfChanges(pullRequest.title ?? "", yield* pathsSinceMergeBase(ends.base, ends.head, root));
    return selected.kind === "pull-request" ? { ...selected, ends } : selected;
  });
  return yield* scope.pipe(
    Effect.catch((cause) => Effect.succeed<RunScope>({ kind: "whole", because: `the pull request's changes cannot be read: ${cause.message}` })),
  );
});
