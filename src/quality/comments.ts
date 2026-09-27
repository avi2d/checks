import { Effect, Schema } from "effect";
import { commentsIn, refusalsIn, syntaxOf, unreadable, type Syntax } from "./comment-matchers.ts";

export { SYNTAXES, syntaxOf, type Comment } from "./comment-matchers.ts";

export class UnreadableCode extends Schema.TaggedError<UnreadableCode>()("UnreadableCode", {
  message: Schema.String,
}) {}

export function syntaxFor(path: string): Effect.Effect<Syntax, UnreadableCode> {
  const syntax = syntaxOf(path);
  return syntax ? Effect.succeed(syntax) : Effect.fail(new UnreadableCode({ message: unreadable(path) }));
}

export const comments = Effect.fn("comments")(function* (path: string, source: string) {
  return commentsIn(source, yield* syntaxFor(path));
});

export const refused = Effect.fn("refused")(function* (path: string, source: string, within?: ReadonlySet<number>) {
  return refusalsIn(path, source, yield* syntaxFor(path), within);
});
