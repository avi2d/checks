import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { requiredInput } from "./lib/inputs.ts";
import { commandOutput, commandPasses } from "./lib/run.ts";

const ACTION = "pages-publish";

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const BOT_IDENTITY = { GIT_AUTHOR_NAME: BOT_NAME, GIT_AUTHOR_EMAIL: BOT_EMAIL, GIT_COMMITTER_NAME: BOT_NAME, GIT_COMMITTER_EMAIL: BOT_EMAIL };

const KEPT = new Set([".git", "CNAME"]);

class PublishError extends Schema.TaggedError<PublishError>()("PublishError", {
  message: Schema.String,
}) {}

type Publish = {
  readonly site: string;
  readonly build: string;
  readonly repository: string;
  readonly cname: string;
  readonly branch: string;
  readonly commitMessage: string;
  readonly sourceSha: string;
};

// Pages takes the custom domain from CNAME, so a push without it unbinds the domain.
const requireCname = Effect.fn("requireCname")(function* ({ site, repository, cname }: Publish) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(site, "CNAME");
  const named = (yield* fs.exists(file)) ? (yield* fs.readFileString(file)).replace(/\n+$/, "") : undefined;
  if (named !== cname) return yield* new PublishError({ message: `${repository} holds no CNAME naming ${cname}` });
});

// Jekyll would drop every folder whose name starts with an underscore, such as _assets/.
const replaceTree = Effect.fn("replaceTree")(function* ({ site, build }: Publish) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of (yield* fs.readDirectory(site)).filter((name) => !KEPT.has(name))) {
    yield* fs.remove(path.join(site, entry), { recursive: true, force: true });
  }
  for (const entry of (yield* fs.readDirectory(build)).filter((name) => name !== "CNAME")) {
    yield* fs.copy(path.join(build, entry), path.join(site, entry), { overwrite: true });
  }
  yield* fs.writeFileString(path.join(site, ".nojekyll"), "", { flag: "a" });
});

const git = (site: string, args: readonly string[]) => commandPasses("git", ["-C", site, ...args], BOT_IDENTITY);

const commitAndPush = Effect.fn("commitAndPush")(function* ({ site, repository, branch, commitMessage, sourceSha }: Publish) {
  if (!(yield* git(site, ["add", "--all"]))) return yield* new PublishError({ message: `git add failed in ${site}` });
  const status = yield* commandOutput("git", ["-C", site, "status", "--porcelain"]);
  if (!status.passed) return yield* new PublishError({ message: `git status failed in ${site}` });
  if (status.stdout.trim() === "") {
    yield* Console.log(`${repository} already holds this build`);
    return "unchanged" as const;
  }
  if (!(yield* git(site, ["commit", "--quiet", "-m", `${commitMessage} ${sourceSha.slice(0, 7)}`]))) {
    return yield* new PublishError({ message: `git commit failed in ${site}` });
  }
  if (!(yield* git(site, ["push", "--quiet", "origin", `HEAD:${branch}`]))) {
    return yield* new PublishError({ message: `git push to ${repository} ${branch} failed` });
  }
  yield* Console.log(`pushed the build to ${repository} ${branch}`);
  return "pushed" as const;
});

const publish = Effect.fn("publish")(function* (target: Publish) {
  yield* requireCname(target).pipe(Effect.catchTag("PlatformError", (cause) => Effect.fail( new PublishError({ message: `${ACTION} cannot read the CNAME: ${cause.message}` }))));
  yield* replaceTree(target).pipe(Effect.mapError((cause) => new PublishError({ message: `${ACTION} cannot copy ${target.build} into ${target.site}: ${cause.message}` })));
  return yield* commitAndPush(target);
});

const guard = requiredInput(ACTION, "deploy-key", "DEPLOY_KEY").pipe(Effect.as(true));

const publishFromEnv = Effect.gen(function* () {
  yield* publish({
    site: yield* requiredInput(ACTION, "path", "SITE_PATH"),
    build: yield* requiredInput(ACTION, "directory", "DIRECTORY"),
    repository: yield* requiredInput(ACTION, "repository", "REPOSITORY"),
    cname: yield* requiredInput(ACTION, "cname", "CNAME"),
    branch: yield* requiredInput(ACTION, "branch", "BRANCH"),
    commitMessage: yield* requiredInput(ACTION, "commit-message", "COMMIT_MESSAGE"),
    sourceSha: yield* requiredInput(ACTION, "source-sha", "SOURCE_SHA"),
  });
  return true;
});

export const main = Effect.fn("pagesPublish")(function* (part: string | undefined) {
  if (part === "guard") return yield* guard;
  if (part === "publish") return yield* publishFromEnv;
  return yield* new PublishError({ message: `${ACTION} takes guard or publish, not ${part ?? "nothing"}` });
});
