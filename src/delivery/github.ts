import { Effect, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { collect } from "../core/git.ts";

export class GitHubFailure extends Schema.TaggedError<GitHubFailure>()("GitHubFailure", {
  message: Schema.String,
}) {}

type Method = "GET" | "POST" | "PATCH";

type Decode<A> = (text: string) => Effect.Effect<A, Schema.SchemaError>;

// gh fills {owner} and {repo} from the checkout's remote, so a workflow names no repository.
export const REPOSITORY = "repos/{owner}/{repo}";

const gitHub = Effect.fn("gitHub")(function* (method: Method, path: string, body?: unknown) {
  const failed = (reason: string): GitHubFailure => new GitHubFailure({ message: `gh api ${method} ${path}: ${reason.trim()}` });
  const input = body === undefined ? [] : ["--input", "-"];
  const feed = body === undefined ? {} : { input: JSON.stringify(body) };
  const { stdout, stderr, exitCode } = yield* collect("gh", ["api", "--method", method, path, ...input], undefined, feed).pipe(
    Effect.mapError((cause) => failed(cause.message)),
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
  return stdout;
});

export function gitHubJson<A>(decode: Decode<A>, method: Method, path: string, body?: unknown): Effect.Effect<A, GitHubFailure, ChildProcessSpawner.ChildProcessSpawner> {
  return gitHub(method, path, body).pipe(
    Effect.flatMap((text) =>
      decode(text).pipe(Effect.mapError((cause) => new GitHubFailure({ message: `gh api ${method} ${path} answered ${cause.message}` }))),
    ),
  );
}

// A dispatch is the one run a workflow token starts, since GitHub starts no workflow for the token's own push or pull request.
export const dispatch = Effect.fn("dispatch")(function* (workflow: string, ref: string) {
  yield* gitHub("POST", `${REPOSITORY}/actions/workflows/${workflow}/dispatches`, { ref });
});
