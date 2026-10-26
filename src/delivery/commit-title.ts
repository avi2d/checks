#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { collect, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";

const NAME = "commit-title";

class TitleSetup extends Schema.TaggedError<TitleSetup>()("TitleSetup", {
  message: Schema.String,
}) {}

const setup = (message: string): TitleSetup => new TitleSetup({ message });

// The cli entry stays inside its own package, so this resolves from the install cache as well as node_modules.
const cliOf = Effect.fn("cliOf")(function* () {
  const entry = yield* Effect.try({
    try: () => new URL("./cli.js", import.meta.resolve("@commitlint/cli")),
    catch: () => setup("cannot resolve @commitlint/cli from the installed kit"),
  });
  return yield* (yield* Path.Path).fromFileUrl(entry);
});

// The config ships with the kit, so it sits two levels above this file wherever the kit is installed.
const configOf = Effect.fn("configOf")(function* () {
  const file = yield* Effect.try({
    try: () => new URL("../../commitlint.config.ts", import.meta.url),
    catch: () => setup("cannot resolve commitlint.config.ts from the installed kit"),
  });
  return yield* (yield* Path.Path).fromFileUrl(file);
});

const dispatchedTitle = Effect.fn("dispatchedTitle")(function* () {
  const repository = yield* Config.String("GITHUB_REPOSITORY").pipe(Config.withDefault(""));
  const owner = yield* Config.String("GITHUB_REPOSITORY_OWNER").pipe(Config.withDefault(""));
  const ref = yield* Config.String("GITHUB_REF_NAME").pipe(Config.withDefault(""));
  if (repository === "" || owner === "" || ref === "") {
    return yield* setup("a dispatched run lints the open pull request its branch heads, so it needs GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER and GITHUB_REF_NAME");
  }
  // A dispatched run carries no pull request, so the title comes from the one open pull request the branch heads.
  const found = yield* collect("gh", [
    "api",
    `repos/${repository}/pulls?head=${owner}:${ref}&state=open`,
    "--jq",
    `if length == 1 then .[0].title elif length == 0 then empty else error("more than one open pull request heads the branch") end`,
  ]);
  const title = found.stdout.trim();
  if (found.exitCode !== 0 || title === "null") {
    const report = found.stderr.trim() === "" ? found.stdout.trim() : found.stderr.trim();
    if (report !== "") yield* Console.error(report);
    return undefined;
  }
  if (title !== "") return landedTitle(title);
  // With no pull request the head commit lands as it is, so its own subject is the one to lint.
  return (yield* git(["log", "-1", "--format=%s", "HEAD"])).trim();
});

// GitHub appends the pull request number to the squashed subject.
function landedTitle(title: string): string {
  return `${title} (#0000)`;
}

const lintTitle = Effect.fn("lintTitle")(function* (subject: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(yield* system.makeTempDirectoryScoped({ prefix: "checks-commit-title-" }), "pr-title");
  yield* system.writeFileString(file, subject);
  // A title opening with the git comment character lints as empty without this: commentChar moves off the hash.
  const linted = yield* collect(process.execPath, [yield* cliOf(), "--config", yield* configOf(), "--edit", file], undefined, {
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.commentChar", GIT_CONFIG_VALUE_0: "\x01" },
  });
  if (linted.stdout.trim() !== "") yield* Console.log(linted.stdout.trim());
  if (linted.stderr.trim() !== "") yield* Console.error(linted.stderr.trim());
  return linted.exitCode === 0;
});

const check = Effect.scoped(Effect.gen(function* () {
  const direct = yield* Config.String("PR_TITLE").pipe(Config.withDefault(""));
  if (direct !== "") return yield* lintTitle(landedTitle(direct));
  const event = yield* Config.String("GITHUB_EVENT_NAME").pipe(Config.withDefault(""));
  if (event === "workflow_dispatch") {
    const title = yield* dispatchedTitle();
    if (title === undefined) return false;
    return yield* lintTitle(title);
  }
  yield* Console.log(`${NAME}: no pull request title is available, so there is nothing to lint`);
  return true;
}));

if (import.meta.main) runMain(NAME, check);
