#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { runMain, Usage } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";
import { pinnedGitleaks, scanDirectory, type Leak } from "./gitleaks.ts";
import { gh, gitHubJson, GitHubFailure, REPOSITORY } from "./github.ts";
import { scanConfig } from "./secrets-pack.ts";

const NAME = "pr-text";
const USAGE = "usage: pr-text.ts <pull-request-number>";

const PullRequest = Schema.Struct({ title: Schema.String, body: Schema.NullOr(Schema.String) });

const Comment = Schema.Struct({ id: Schema.Int, html_url: Schema.String, body: Schema.NullOr(Schema.String) });

const decodePullRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequest));

const decodeCommentPages = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Array(Comment))));

export type Text = { readonly file: string; readonly place: string; readonly body: string };

const COMMENT_KINDS = [
  { file: "issue-comment", parent: "issues", list: "comments" },
  { file: "review", parent: "pulls", list: "reviews" },
  { file: "review-comment", parent: "pulls", list: "comments" },
] as const;

const numberOf = Effect.fn("numberOf")(function* (args: readonly string[]) {
  const [number, ...rest] = args;
  if (number === undefined || rest.length > 0 || !/^[1-9]\d*$/.test(number)) return yield* new Usage({ message: USAGE });
  return number;
});

const commentsOf = Effect.fn("commentsOf")(function* (path: string) {
  const pages = yield* gh(["api", "--paginate", "--slurp", path], `gh api --paginate ${path}`);
  return (yield* decodeCommentPages(pages).pipe(Effect.mapError((cause) => new GitHubFailure({ message: `gh api ${path} answered ${cause.message}` })))).flat();
});

// The title and the body come from the API rather than the event, which carries them as they stood when the event fired.
const textsOf = Effect.fn("textsOf")(function* (number: string) {
  const { title, body } = yield* gitHubJson(decodePullRequest, "GET", `${REPOSITORY}/pulls/${number}`);
  const comments = yield* Effect.forEach(COMMENT_KINDS, (kind) =>
    commentsOf(`${REPOSITORY}/${kind.parent}/${number}/${kind.list}`).pipe(
      Effect.map((found) => found.map(({ id, html_url, body: text }) => ({ file: `${kind.file}-${id}`, place: html_url, body: text ?? "" }))),
    ),
  );
  return [{ file: "title", place: "the title", body: title }, { file: "body", place: "the body", body: body ?? "" }, ...comments.flat()] satisfies readonly Text[];
});

export function report(number: string, texts: readonly Text[], leaks: readonly Leak[]): string {
  if (leaks.length === 0) return `${NAME}: pull request ${number} carries no secret and no private term`;
  const order = new Map(texts.map(({ file }, index) => [file, index]));
  const placeOf = new Map(texts.map(({ file, place }) => [file, place]));
  const fileOf = (leak: Leak) => leak.File.slice(leak.File.lastIndexOf("/") + 1);
  const sorted = leaks.toSorted((left, right) => (order.get(fileOf(left)) ?? 0) - (order.get(fileOf(right)) ?? 0) || left.StartLine - right.StartLine || left.RuleID.localeCompare(right.RuleID));
  return [
    `${NAME}: pull request ${number} carries ${leaks.length} secret(s) or private term(s); delete each from the text it names, and delete the revision GitHub keeps in that text's edit history:`,
    ...sorted.map((leak) => `  ${placeOf.get(fileOf(leak)) ?? fileOf(leak)}:${leak.StartLine} ${leak.RuleID}: ${leak.Description}`),
  ].join("\n");
}

const prText = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const number = yield* numberOf(process.argv.slice(2));
  const { config, notice } = yield* scanConfig(NAME, yield* fs.makeTempDirectoryScoped({ prefix: "checks-pr-text-pack-" }));
  const texts = yield* textsOf(number);
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-pr-text-" });
  yield* Effect.forEach(texts, ({ file, body }) => fs.writeFileString(path.join(dir, file), body));
  const ignoreDir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-pr-text-ignore-" });
  const leaks = yield* scanDirectory({ binary: yield* pinnedGitleaks(yield* cacheRoot()), dir, config, ignoreDir });
  yield* Console.log(report(number, texts, leaks));
  yield* Console.log(notice);
  return leaks.length === 0;
}).pipe(Effect.scoped);

if (import.meta.main) runMain(NAME, prText);
