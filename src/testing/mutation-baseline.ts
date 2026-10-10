#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";

class BaselineFailure extends Schema.TaggedError<BaselineFailure>()("BaselineFailure", {
  message: Schema.String,
}) {}

const NAME = "checks-mutation-baseline";
const USAGE = "usage: checks-mutation-baseline [--full] <incremental-dest> [mutation-json-dest]";
const WORKFLOW = "mutation.yml";
const BRANCH = "main";
const INCREMENTAL = "stryker-incremental.json";
const REPORT = "mutation/mutation.json";
const KEPT_PER_ARTIFACT = 2;
const LATEST_ARTIFACT = "mutation-baseline";
const FULL_ARTIFACT = "mutation-baseline-full";
const LATEST_LIMIT = 20;
const FULL_LIMIT = 50;
const FULL_EVENTS = ["schedule", "workflow_dispatch"];

type Destinations = { readonly incremental: string; readonly report: string | undefined };

const Run = Schema.Struct({ databaseId: Schema.Int, event: Schema.String, createdAt: Schema.String });
type Run = typeof Run.Type;

const Artifact = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  expired: Schema.Boolean,
  workflow_run: Schema.Struct({ repository_id: Schema.Int }),
});
type Artifact = typeof Artifact.Type;

const decodeRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Run)));
const decodeArtifacts = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ artifacts: Schema.Array(Artifact) })));

const gh = Effect.fn("gh")(function* (args: readonly string[]) {
  const failed = (reason: string): BaselineFailure => new BaselineFailure({ message: `gh ${args.join(" ")}: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("gh", args).pipe(Effect.mapError((cause) => failed(cause.message)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
  return stdout;
});

const warned = <A>(fallback: A) => (failure: BaselineFailure) => Console.error(`mutation-baseline: ${failure.message}`).pipe(Effect.as(fallback));

const listed = Effect.fn("listed")(function* (event: string | undefined, limit: number) {
  const filter = event === undefined ? [] : ["--event", event];
  const args = ["run", "list", "--workflow", WORKFLOW, "--branch", BRANCH, "--status", "success", ...filter, "--limit", String(limit), "--json", "databaseId,event,createdAt"];
  return yield* gh(args).pipe(
    Effect.flatMap(decodeRuns),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
  );
});

export function newestFirst(runs: readonly Run[]): readonly number[] {
  return [...runs].sort((one, other) => other.createdAt.localeCompare(one.createdAt)).map((run) => run.databaseId);
}

const latestCandidates = Effect.gen(function* () {
  const newest = (yield* listed(undefined, LATEST_LIMIT)).find((run) => run.event !== "pull_request");
  return newest === undefined ? [] : [newest.databaseId];
});

// Each full event is listed on its own, because one shared window lets push runs crowd out every full run.
const fullCandidates = Effect.gen(function* () {
  const perEvent = yield* Effect.forEach(FULL_EVENTS, (event) => listed(event, FULL_LIMIT));
  return newestFirst(perEvent.flat());
});

const artifactOf = Effect.fn("artifactOf")(function* (run: number, name: string) {
  const found = yield* gh(["api", `repos/{owner}/{repo}/actions/runs/${run}/artifacts?name=${name}`]).pipe(
    Effect.flatMap(decodeArtifacts),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
  );
  return Option.fromNullishOr(found.artifacts.find((artifact) => artifact.name === name && !artifact.expired));
});

const holdsState = Effect.fn("holdsState")(function* (dir: string) {
  return yield* (yield* FileSystem.FileSystem).exists((yield* Path.Path).join(dir, INCREMENTAL));
});

const downloaded = Effect.fn("downloaded")(function* (run: number, artifact: Artifact, dir: string) {
  const fetched = yield* gh(["run", "download", String(run), "--name", artifact.name, "--dir", dir]).pipe(Effect.as(true), Effect.catch(warned(false)));
  return fetched && (yield* holdsState(dir));
});

export function pruned(entries: readonly string[], kept: number): readonly string[] {
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .sort((one, other) => Number(other) - Number(one))
    .slice(kept);
}

const prune = Effect.fn("prune")(function* (shelf: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of pruned(yield* fs.readDirectory(shelf), KEPT_PER_ARTIFACT)) {
    yield* fs.remove(path.join(shelf, entry), { recursive: true, force: true });
  }
});

type Fetched = { readonly dir: string; readonly how: string };

// The entry lands through a rename beside it, so a job sharing the runner sees it whole or not at all.
const throughCache = Effect.fn("throughCache")(function* (run: number, artifact: Artifact, root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shelf = path.join(root, "mutation-baseline", String(artifact.workflow_run.repository_id), artifact.name);
  const entry = path.join(shelf, String(artifact.id));
  if (yield* holdsState(entry)) return Option.some<Fetched>({ dir: entry, how: "restored it from the runner's cache" });
  yield* fs.makeDirectory(shelf, { recursive: true });
  const staged = path.join(yield* fs.makeTempDirectoryScoped({ directory: shelf, prefix: ".staging-" }), "artifact");
  if (!(yield* downloaded(run, artifact, staged))) return Option.none<Fetched>();
  yield* fs.remove(entry, { recursive: true, force: true });
  yield* fs.rename(staged, entry);
  yield* prune(shelf);
  return Option.some<Fetched>({ dir: entry, how: "downloaded it into the runner's cache" });
});

const uncached = Effect.fn("uncached")(function* (run: number, artifact: Artifact) {
  const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "mutation-baseline-" });
  return (yield* downloaded(run, artifact, dir)) ? Option.some<Fetched>({ dir, how: "downloaded it" }) : Option.none<Fetched>();
});

const restore = Effect.fn("restore")(function* (from: string, to: Destinations) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const copy = Effect.fn("copy")(function* (file: string, dest: string) {
    yield* fs.makeDirectory(path.dirname(dest), { recursive: true });
    yield* fs.copyFile(path.join(from, file), dest);
  });
  yield* copy(INCREMENTAL, to.incremental);
  if (to.report !== undefined && (yield* fs.exists(path.join(from, REPORT)))) yield* copy(REPORT, to.report);
});

const restoredFrom = Effect.fn("restoredFrom")(
  function* (run: number, artifact: Artifact, root: Option.Option<string>, to: Destinations) {
    const fetched = Option.isSome(root) ? yield* throughCache(run, artifact, root.value) : yield* uncached(run, artifact);
    if (Option.isNone(fetched)) return false;
    yield* restore(fetched.value.dir, to);
    yield* Console.log(`mutation-baseline: ${fetched.value.how}, ${artifact.name} artifact ${artifact.id} from run ${run}`);
    return true;
  },
  Effect.scoped,
);

// A hosted runner is a fresh machine every job, so a cache there only costs a copy.
const runnerCache = Effect.gen(function* () {
  const environment = yield* Config.String("RUNNER_ENVIRONMENT").pipe(Config.withDefault(""));
  if (environment === "github-hosted") return Option.none<string>();
  return yield* cacheRoot().pipe(Effect.option);
});

type Request = { readonly full: boolean; readonly to: Destinations };

function parsed(args: readonly string[]): Request | undefined {
  const full = args[0] === "--full";
  const [incremental, report, ...extra] = full ? args.slice(1) : args;
  if (incremental === undefined || incremental.startsWith("-") || extra.length > 0) return undefined;
  return { full, to: { incremental, report } };
}

const mutationBaseline = Effect.gen(function* () {
  const request = parsed(process.argv.slice(2));
  if (request === undefined) return yield* new Usage({ message: USAGE });
  const name = request.full ? FULL_ARTIFACT : LATEST_ARTIFACT;
  const root = yield* runnerCache;
  for (const run of yield* request.full ? fullCandidates : latestCandidates) {
    const artifact = yield* artifactOf(run, name).pipe(Effect.catch(warned(Option.none<Artifact>())));
    if (Option.isSome(artifact) && (yield* restoredFrom(run, artifact.value, root, request.to))) return true;
  }
  yield* Console.log(`mutation-baseline: no successful ${BRANCH} run holds a ${name} artifact, so nothing was restored`);
  return true;
});

if (import.meta.main) runMain(NAME, mutationBaseline);
