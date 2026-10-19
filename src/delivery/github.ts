import { Effect, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect, type Feed } from "../core/git.ts";

export class GitHubFailure extends Schema.TaggedError<GitHubFailure>()("GitHubFailure", {
  message: Schema.String,
}) {}

type Method = "GET" | "POST" | "PATCH";

type Decode<A> = (text: string) => Effect.Effect<A, Schema.SchemaError>;

// gh fills {owner} and {repo} from the checkout's remote, so a workflow names no repository.
export const REPOSITORY = "repos/{owner}/{repo}";

export const gh = Effect.fn("gh")(function* (args: readonly string[], call = `gh ${args.join(" ")}`, feed: Feed = {}) {
  const failed = (reason: string): GitHubFailure => new GitHubFailure({ message: `${call}: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("gh", args, undefined, feed).pipe(Effect.mapError((cause) => failed(cause.message)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
  return stdout;
});

const gitHub = (method: Method, path: string, body?: unknown) =>
  gh(["api", "--method", method, path, ...(body === undefined ? [] : ["--input", "-"])], `gh api ${method} ${path}`, body === undefined ? {} : { input: JSON.stringify(body) });

export function gitHubJson<A>(decode: Decode<A>, method: Method, path: string, body?: unknown): Effect.Effect<A, GitHubFailure, ChildProcessSpawner.ChildProcessSpawner> {
  return gitHub(method, path, body).pipe(
    Effect.flatMap((text) =>
      decode(text).pipe(Effect.mapError((cause) => new GitHubFailure({ message: `gh api ${method} ${path} answered ${cause.message}` }))),
    ),
  );
}

// A dispatch is the one run a workflow token starts at once: GitHub starts none for the token's push, and holds its pull request's runs for approval.
export const dispatch = Effect.fn("dispatch")(function* (workflow: string, ref: string) {
  yield* gitHub("POST", `${REPOSITORY}/actions/workflows/${workflow}/dispatches`, { ref });
});
