import { Effect, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect, type Feed } from "./git.ts";

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

const PAGE_SIZE = 100;

const decodeNumbered = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ number: Schema.Int })));
const decodeAny = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeIssues = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Int, body: Schema.NullOr(Schema.String), pull_request: Schema.optionalKey(Schema.Unknown) }))),
);
const decodeComments = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Struct({ body: Schema.String }))));

export type Label = { readonly name: string; readonly color: string; readonly description: string };

export type LabelledIssue = { readonly number: number; readonly body: string | null };

const everyPage = <A>(page: (at: number) => Effect.Effect<readonly A[], GitHubFailure, ChildProcessSpawner.ChildProcessSpawner>) =>
  Effect.gen(function* () {
    const found: A[] = [];
    for (let at = 1; ; at += 1) {
      const batch = yield* page(at);
      found.push(...batch);
      if (batch.length < PAGE_SIZE) return found;
    }
  });

// The issues endpoint lists pull requests too, so each one is dropped.
const openIssues = (label: string) =>
  everyPage((page) => gitHubJson(decodeIssues, "GET", `${REPOSITORY}/issues?labels=${label}&state=open&per_page=${PAGE_SIZE}&page=${page}`)).pipe(
    Effect.map((issues): readonly LabelledIssue[] => issues.filter((issue) => issue.pull_request === undefined).map(({ number, body }) => ({ number, body }))),
  );

const issueComments = (issue: number) =>
  everyPage((page) => gitHubJson(decodeComments, "GET", `${REPOSITORY}/issues/${issue}/comments?per_page=${PAGE_SIZE}&page=${page}`)).pipe(
    Effect.map((comments) => comments.map(({ body }) => body)),
  );

export const labelledIssues = Effect.fn("labelledIssues")(function* ({ name, color, description }: Label) {
  const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
  const provided = <A>(effect: Effect.Effect<A, GitHubFailure, ChildProcessSpawner.ChildProcessSpawner>) => effect.pipe(Effect.provideContext(services));
  return {
    ensureLabel: provided(gh(["label", "create", name, "--color", color, "--description", description, "--force"]).pipe(Effect.asVoid)),
    open: provided(openIssues(name)),
    create: (title: string, body: string) => provided(gitHubJson(decodeNumbered, "POST", `${REPOSITORY}/issues`, { title, body, labels: [name] })).pipe(Effect.map(({ number }) => number)),
    comment: (issue: number, body: string) => provided(gitHubJson(decodeAny, "POST", `${REPOSITORY}/issues/${issue}/comments`, { body })).pipe(Effect.asVoid),
    close: (issue: number) => provided(gitHubJson(decodeAny, "PATCH", `${REPOSITORY}/issues/${issue}`, { state: "closed", state_reason: "completed" })).pipe(Effect.asVoid),
    comments: (issue: number) => provided(issueComments(issue)),
  };
});

// A dispatch is the one run a workflow token starts at once: GitHub starts none for the token's push, and holds its pull request's runs for approval.
export const dispatch = Effect.fn("dispatch")(function* (workflow: string, ref: string) {
  yield* gitHub("POST", `${REPOSITORY}/actions/workflows/${workflow}/dispatches`, { ref });
});
