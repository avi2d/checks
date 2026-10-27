#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { gitHubJson, REPOSITORY } from "./github.ts";
import { lastTag } from "./release.ts";
import { refused } from "./release-commit.ts";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";

const LABEL = "release-preflight";
const USAGE = "usage: release-preflight.ts <release-workflow>";
const MANIFEST = "package.json";
const WORKFLOWS = ".github/workflows";

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  repository: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ url: Schema.optional(Schema.String) })])),
});

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));
const decodeWorkflowPermissions = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ can_approve_pull_request_reviews: Schema.Boolean })));

const GITHUB_HTTPS = /^(?:git\+)?https:\/\/github\.com\/([^/]+?)\/([^/]+?)(?:\.git)?\/?$/;
const GITHUB_SCP = /^git@github\.com:([^/]+?)\/([^/]+?)(?:\.git)?\/?$/;

export function ownerRepoOf(url: string): string | undefined {
  const match = GITHUB_HTTPS.exec(url) ?? GITHUB_SCP.exec(url);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

export function publishesToNpm(workflow: string): boolean {
  return workflow.includes("checks-release-publish") || workflow.includes("npm publish");
}

const FlexiblePermissions = Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]);
type FlexiblePermissions = typeof FlexiblePermissions.Type;

const WorkflowDocument = Schema.Struct({
  permissions: Schema.optional(FlexiblePermissions),
  jobs: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const JobDocument = Schema.Struct({ permissions: Schema.optional(FlexiblePermissions) });

const decodeDocument = Schema.decodeUnknownOption(WorkflowDocument);
const decodeJob = Schema.decodeUnknownOption(JobDocument);

function grantsOidcValue(permissions: FlexiblePermissions | undefined): boolean {
  return permissions === "write-all" || (typeof permissions === "object" && permissions["id-token"] === "write");
}

export function grantsOidc(document: unknown): boolean {
  const decoded = decodeDocument(document);
  if (Option.isNone(decoded)) return false;
  if (grantsOidcValue(decoded.value.permissions)) return true;
  const jobs = decoded.value.jobs;
  if (jobs === undefined) return false;
  return Object.values(jobs).some((job) => {
    const decodedJob = decodeJob(job);
    return Option.isSome(decodedJob) && grantsOidcValue(decodedJob.value.permissions);
  });
}

const readManifest = Effect.fn("readManifest")(function* (root: string) {
  const file = (yield* Path.Path).join(root, MANIFEST);
  return yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(
    Effect.flatMap(decodeManifest),
    Effect.mapError((cause) => refused(`${MANIFEST}: ${cause.message}`)),
  );
});

const checkTag = Effect.fn("checkTag")(function* (root: string) {
  const { version } = yield* readManifest(root);
  const since = yield* lastTag(root);
  if (since !== undefined && since !== `v${version}`) {
    return yield* refused(
      `${MANIFEST} holds ${version}, but the last release tag is ${since}, so v${version} is untagged; rerun the release that bumped it, whose refusal says what to fix, or return ${MANIFEST} to ${since.slice(1)}`,
    );
  }
  yield* Console.log(`${LABEL}: ${MANIFEST} holds ${version}, which ${since === undefined ? "has no release tag yet" : `matches ${since}`}`);
});

const checkPublisher = Effect.fn("checkPublisher")(function* (root: string, workflow: string) {
  const path = (yield* Path.Path).join(root, WORKFLOWS, workflow);
  const text = yield* (yield* FileSystem.FileSystem).readFileString(path).pipe(
    Effect.mapError(() => refused(`${WORKFLOWS}/${workflow} is missing, so the run cannot prove it matches npm's trusted publisher`)),
  );
  if (!publishesToNpm(text)) {
    yield* Console.log(`${LABEL}: ${workflow} publishes nothing to npm, so no trusted publisher has to match`);
    return;
  }
  const document = yield* Effect.try({
    try: () => Bun.YAML.parse(text),
    catch: () => refused(`${WORKFLOWS}/${workflow} does not parse, so the run cannot prove it matches npm's trusted publisher`),
  });
  const repository = yield* Config.String("GITHUB_REPOSITORY").pipe(Config.withDefault(""));
  if (repository === "") return yield* refused("GITHUB_REPOSITORY is not set, so the run has no repository to match; run this in the release workflow");
  const { name, repository: field } = yield* readManifest(root);
  const raw = typeof field === "string" ? field : field?.url;
  if (raw === undefined) {
    return yield* refused(
      `${MANIFEST} has no repository, so npm's trusted publisher has nothing to match the run in ${repository} against; point repository.url at ${repository}`,
    );
  }
  const held = ownerRepoOf(raw);
  if (held === undefined) {
    return yield* refused(
      `${MANIFEST} names the repository ${raw}, which is no GitHub owner and name, so npm's trusted publisher has nothing to match the run in ${repository} against; point repository.url at ${repository}`,
    );
  }
  if (held.toLowerCase() !== repository.toLowerCase()) {
    return yield* refused(
      `${MANIFEST} names the repository ${held}, but the run is in ${repository}, so npm's trusted publisher for ${name} matches no run here; point repository.url at ${repository}, or move the trusted publisher on npm to ${held} and ${workflow}`,
    );
  }
  if (!grantsOidc(document)) {
    return yield* refused(
      `${WORKFLOWS}/${workflow} grants no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs`,
    );
  }
  yield* Console.log(`${LABEL}: npm's trusted publisher for ${name} matches the run in ${repository}`);
});

const checkApprovals = Effect.fn("checkApprovals")(function* () {
  const repository = yield* Config.String("GITHUB_REPOSITORY").pipe(Config.withDefault("{owner}/{repo}"));
  const { can_approve_pull_request_reviews } = yield* gitHubJson(decodeWorkflowPermissions, "GET", `${REPOSITORY}/actions/permissions/workflow`);
  if (!can_approve_pull_request_reviews) {
    return yield* refused(
      `the repository forbids GitHub Actions from creating and approving pull requests, so the daily release cannot open its release pull request; allow it with \u0060gh api --method PUT repos/${repository}/actions/permissions/workflow -F can_approve_pull_request_reviews=true\u0060`,
    );
  }
  yield* Console.log(`${LABEL}: the repository lets GitHub Actions create and approve the release pull request`);
});

const releasePreflight = Effect.gen(function* () {
  const [workflow, ...extra] = process.argv.slice(2);
  if (workflow === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  yield* checkTag(root);
  yield* checkPublisher(root, workflow);
  yield* checkApprovals();
  return true;
});

if (import.meta.main) runMain("checks-release-preflight", releasePreflight);
