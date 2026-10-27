#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
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

const GITHUB_HTTPS = /^(?:git\+)?https:\/\/github\.com\/([^/]+?)\/([^/]+?)(?:\.git)?\/?$/;
const GITHUB_SCP = /^git@github\.com:([^/]+?)\/([^/]+?)(?:\.git)?\/?$/;

export function ownerRepoOf(url: string): string | undefined {
  const match = GITHUB_HTTPS.exec(url) ?? GITHUB_SCP.exec(url);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

export function publishesToNpm(command: string): boolean {
  return command.includes("release-publish") || command.includes("npm publish");
}

const FlexiblePermissions = Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]);
type FlexiblePermissions = typeof FlexiblePermissions.Type;

const WorkflowDocument = Schema.Struct({
  permissions: Schema.optional(FlexiblePermissions),
  jobs: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const StepDocument = Schema.Struct({ run: Schema.optional(Schema.String) });
const JobDocument = Schema.Struct({
  permissions: Schema.optional(FlexiblePermissions),
  steps: Schema.optional(Schema.Array(Schema.Unknown)),
});

const decodeDocument = Schema.decodeUnknownOption(WorkflowDocument);
const decodeJob = Schema.decodeUnknownOption(JobDocument);
const decodeStep = Schema.decodeUnknownOption(StepDocument);

function grantsOidcValue(permissions: FlexiblePermissions | undefined): boolean {
  return permissions === "write-all" || (typeof permissions === "object" && permissions["id-token"] === "write");
}

function runsOf(job: unknown): string[] {
  const decoded = decodeJob(job);
  if (Option.isNone(decoded) || decoded.value.steps === undefined) return [];
  return decoded.value.steps.flatMap((step) => {
    const decodedStep = decodeStep(step);
    return Option.isNone(decodedStep) || decodedStep.value.run === undefined ? [] : [decodedStep.value.run];
  });
}

function jobPublishes(job: unknown): boolean {
  return runsOf(job).some(publishesToNpm);
}

function documentPublishes(document: unknown): boolean {
  const decoded = decodeDocument(document);
  if (Option.isNone(decoded) || decoded.value.jobs === undefined) return false;
  return Object.values(decoded.value.jobs).some(jobPublishes);
}

export function grantsOidc(document: unknown): boolean {
  const decoded = decodeDocument(document);
  if (Option.isNone(decoded)) return false;
  const jobs = decoded.value.jobs;
  if (jobs === undefined) return false;
  const publishing = Object.values(jobs).filter(jobPublishes);
  if (publishing.length === 0) return false;
  return publishing.every((job) => {
    const decodedJob = decodeJob(job);
    if (Option.isNone(decodedJob)) return false;
    const own = decodedJob.value.permissions;
    return grantsOidcValue(own === undefined ? decoded.value.permissions : own);
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
  if ((yield* git(["rev-parse", "--is-shallow-repository"], root)).trim() === "true") {
    return yield* refused("the checkout is shallow, so the tag it sees may not be the last one; fetch all of it");
  }
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
    Effect.mapError(() => refused(`${WORKFLOWS}/${workflow} is missing, so the run cannot show the prerequisites npm's trusted publisher needs`)),
  );
  const document = yield* Effect.try({
    try: () => Bun.YAML.parse(text),
    catch: () => refused(`${WORKFLOWS}/${workflow} does not parse, so the run cannot show the prerequisites npm's trusted publisher needs`),
  });
  if (!documentPublishes(document)) {
    yield* Console.log(`${LABEL}: ${workflow} publishes nothing to npm, so no trusted publisher has to match`);
    return;
  }
  const repository = yield* Config.String("GITHUB_REPOSITORY").pipe(Config.withDefault(""));
  if (repository === "") return yield* refused("GITHUB_REPOSITORY is not set, so the run has no repository to match; run this in the release workflow");
  const { name, repository: field } = yield* readManifest(root);
  const raw = typeof field === "string" ? field : field?.url;
  if (raw === undefined) {
    return yield* refused(
      `${MANIFEST} has no repository, so the run holds no repository for npm's trusted publisher to allow; point repository.url at ${repository}`,
    );
  }
  const held = ownerRepoOf(raw);
  if (held === undefined) {
    return yield* refused(
      `${MANIFEST} names the repository ${raw}, which is no GitHub owner and name, so the run holds no repository for npm's trusted publisher to allow; point repository.url at ${repository}`,
    );
  }
  if (held.toLowerCase() !== repository.toLowerCase()) {
    return yield* refused(
      `${MANIFEST} names the repository ${held}, but the run is in ${repository}, so the run cannot present npm's trusted publisher for ${name}; point repository.url at ${repository}, or move the trusted publisher on npm to ${held} and ${workflow}`,
    );
  }
  if (!grantsOidc(document)) {
    return yield* refused(
      `${WORKFLOWS}/${workflow} grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs`,
    );
  }
  yield* Console.log(
    `${LABEL}: ${MANIFEST} names ${repository} and ${workflow} grants the publishing job id-token: write, so the run holds the prerequisites for npm's trusted publisher for ${name}`,
  );
});

const releasePreflight = Effect.gen(function* () {
  const [workflow, ...extra] = process.argv.slice(2);
  if (workflow === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  yield* checkTag(root);
  yield* checkPublisher(root, workflow);
  return true;
});

if (import.meta.main) runMain("checks-release-preflight", releasePreflight);
