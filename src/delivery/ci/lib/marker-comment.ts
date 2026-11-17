import { Effect, Schema } from "effect";
import { github, repositoryFromEnv, type Repository } from "./github.ts";
import { InputMissing, optionalInput, requiredInput } from "./inputs.ts";

const Comment = Schema.Struct({
  id: Schema.Finite,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
});

const Comments = Schema.Array(Comment);

const Written = Schema.Struct({ id: Schema.Finite });

export type Thread = { readonly repository: Repository; readonly pullRequest: string; readonly marker: string; readonly author: string };

const PAGE_SIZE = 100;

export function markedBy(comments: typeof Comments.Type, marker: string, author: string): number | undefined {
  return comments.find((comment) => comment.user?.login === author && (comment.body ?? "").startsWith(marker))?.id;
}

const requirePullRequest = Effect.fn("requirePullRequest")(function* (action: string, pullRequest: string) {
  if (!/^[1-9][0-9]*$/.test(pullRequest)) {
    return yield* new InputMissing({ message: `${action} needs the pull-request input to be a pull request number, not '${pullRequest}'` });
  }
  return pullRequest;
});

export const threadFromEnv = Effect.fn("threadFromEnv")(function* (action: string) {
  return {
    repository: yield* repositoryFromEnv(action),
    pullRequest: yield* requirePullRequest(action, yield* optionalInput("PULL_REQUEST")),
    marker: yield* requiredInput(action, "marker", "MARKER"),
    author: yield* requiredInput(action, "author", "AUTHOR"),
  } satisfies Thread;
});

const findMarked = Effect.fn("findMarked")(function* ({ repository, pullRequest, marker, author }: Thread) {
  for (let page = 1; ; page += 1) {
    const comments = yield* github(repository, Comments, "GET", `/issues/${pullRequest}/comments?per_page=${PAGE_SIZE}&page=${page}`);
    const found = markedBy(comments, marker, author);
    if (found !== undefined || comments.length < PAGE_SIZE) return found;
  }
});

const edit = (thread: Thread, id: number, body: string) =>
  github(thread.repository, Written, "PATCH", `/issues/comments/${id}`, { body: `${thread.marker}\n${body}` });

export const writeMarked = Effect.fn("writeMarked")(function* (thread: Thread, body: string) {
  const id = yield* findMarked(thread);
  if (id !== undefined) return yield* edit(thread, id, body).pipe(Effect.as("edited" as const));
  yield* github(thread.repository, Written, "POST", `/issues/${thread.pullRequest}/comments`, { body: `${thread.marker}\n${body}` });
  return "created" as const;
});

export const editMarked = Effect.fn("editMarked")(function* (thread: Thread, body: string) {
  const id = yield* findMarked(thread);
  if (id === undefined) return "absent" as const;
  yield* edit(thread, id, body);
  return "edited" as const;
});
