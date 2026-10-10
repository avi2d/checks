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
const USAGE = "usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest>";
const WORKFLOW = "mutation.yml";
const BRANCH = "main";
const INCREMENTAL = "stryker-incremental.json";
const REPORT = "mutation/mutation.json";
const REPORT_ALONE = "mutation.json";
const KEPT_PER_ARTIFACT = 2;
const LATEST_ARTIFACT = "mutation-baseline";
const FULL_ARTIFACT = "mutation-baseline-full";
const LATEST_LIMIT = 20;
const FULL_LIMIT = 50;
const FULL_EVENTS = ["schedule", "workflow_dispatch"];

// The first of `from` the artifact holds is copied to `to`.
type Copy = { readonly from: readonly string[]; readonly to: string };

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

const held = Effect.fn("held")(function* (dir: string, names: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of names) {
    const file = path.join(dir, name);
    if (yield* fs.exists(file)) return Option.some(file);
  }
  return Option.none<string>();
});

const holds = (dir: string, needed: Copy) => held(dir, needed.from).pipe(Effect.map(Option.isSome));

const downloaded = Effect.fn("downloaded")(function* (run: number, artifact: Artifact, dir: string, needed: Copy) {
  const fetched = yield* gh(["run", "download", String(run), "--name", artifact.name, "--dir", dir]).pipe(Effect.as(true), Effect.catch(warned(false)));
  return fetched && (yield* holds(dir, needed));
});

export function pruned(entries: readonly string[], kept: number, restoring: string): readonly string[] {
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .sort((one, other) => Number(other) - Number(one))
    .slice(kept)
    .filter((entry) => entry !== restoring);
}

const prune = Effect.fn("prune")(function* (shelf: string, restoring: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of pruned(yield* fs.readDirectory(shelf), KEPT_PER_ARTIFACT, restoring)) {
    yield* fs.remove(path.join(shelf, entry), { recursive: true, force: true });
  }
});

type Fetched = { readonly dir: string; readonly how: string };

// The entry lands through a rename beside it, so a job sharing the runner sees it whole or not at all.
const throughCache = Effect.fn("throughCache")(function* (run: number, artifact: Artifact, root: string, needed: Copy) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shelf = path.join(root, "mutation-baseline", String(artifact.workflow_run.repository_id), artifact.name);
  const entry = path.join(shelf, String(artifact.id));
  if (yield* holds(entry, needed)) return Option.some<Fetched>({ dir: entry, how: "restored it from the runner's cache" });
  yield* fs.makeDirectory(shelf, { recursive: true });
  const staged = path.join(yield* fs.makeTempDirectoryScoped({ directory: shelf, prefix: ".staging-" }), "artifact");
  if (!(yield* downloaded(run, artifact, staged, needed))) return Option.none<Fetched>();
  // An entry already there stays, since a job sharing the runner may be copying from it, and the staged copy is whole.
  const placed = yield* fs.rename(staged, entry).pipe(
    Effect.as(entry),
    Effect.orElseSucceed(() => staged),
  );
  yield* prune(shelf, String(artifact.id));
  return Option.some<Fetched>({ dir: placed, how: "downloaded it into the runner's cache" });
});

const uncached = Effect.fn("uncached")(function* (run: number, artifact: Artifact, needed: Copy) {
  const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "mutation-baseline-" });
  return (yield* downloaded(run, artifact, dir, needed)) ? Option.some<Fetched>({ dir, how: "downloaded it" }) : Option.none<Fetched>();
});

const restore = Effect.fn("restore")(function* (from: string, needed: Copy, optional: readonly Copy[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const copy = Effect.fn("copy")(function* (file: string, to: string) {
    yield* fs.makeDirectory(path.dirname(to), { recursive: true });
    yield* fs.copyFile(file, to);
  });
  const source = yield* held(from, needed.from);
  if (Option.isNone(source)) return yield* new BaselineFailure({ message: `${from} lost ${needed.from.join(" and ")} before it was copied` });
  yield* copy(source.value, needed.to);
  for (const wanted of optional) {
    const file = yield* held(from, wanted.from);
    if (Option.isSome(file)) yield* copy(file.value, wanted.to);
  }
});

const restoredFrom = Effect.fn("restoredFrom")(
  function* (run: number, artifact: Artifact, root: Option.Option<string>, request: Request) {
    const fetched = Option.isSome(root) ? yield* throughCache(run, artifact, root.value, request.needed) : yield* uncached(run, artifact, request.needed);
    if (Option.isNone(fetched)) return false;
    yield* restore(fetched.value.dir, request.needed, request.optional);
    yield* Console.log(`mutation-baseline: ${fetched.value.how}, ${artifact.name} artifact ${artifact.id} from run ${run}`);
    return true;
  },
  Effect.scoped,
);

// A hosted runner is a fresh machine every job, so a cache there only costs a copy.
const runnerCache = Effect.gen(function* () {
  const environment = yield* Config.String("RUNNER_ENVIRONMENT").pipe(Config.withDefault(""));
  if (environment === "github-hosted") return Option.none<string>();
  return yield* cacheRoot().pipe(
    Effect.asSome,
    Effect.catchTag("CacheUnrooted", () =>
      Console.error("mutation-baseline: the runner cache is disabled because HOME is unset, so the baseline is downloaded").pipe(Effect.as(Option.none<string>())),
    ),
  );
});

// An artifact that lacks `needed` counts as no baseline, and `optional` copies only what the artifact holds.
type Request = { readonly full: boolean; readonly needed: Copy; readonly optional: readonly Copy[] };

const isDestination = (arg: string | undefined): arg is string => arg !== undefined && !arg.startsWith("-");

function parsed(args: readonly string[]): Request | undefined {
  if (args[0] === "--full") {
    const [report, ...extra] = args.slice(1);
    if (!isDestination(report) || extra.length > 0) return undefined;
    return { full: true, needed: { from: [REPORT_ALONE, REPORT], to: report }, optional: [] };
  }
  const [incremental, report, ...extra] = args;
  if (!isDestination(incremental) || extra.length > 0) return undefined;
  return { full: false, needed: { from: [INCREMENTAL], to: incremental }, optional: report === undefined ? [] : [{ from: [REPORT], to: report }] };
}

const mutationBaseline = Effect.gen(function* () {
  const request = parsed(process.argv.slice(2));
  if (request === undefined) return yield* new Usage({ message: USAGE });
  const name = request.full ? FULL_ARTIFACT : LATEST_ARTIFACT;
  const root = yield* runnerCache;
  for (const run of yield* request.full ? fullCandidates : latestCandidates) {
    const artifact = yield* artifactOf(run, name).pipe(Effect.catch(warned(Option.none<Artifact>())));
    if (Option.isSome(artifact) && (yield* restoredFrom(run, artifact.value, root, request))) return true;
  }
  yield* Console.log(`mutation-baseline: no successful ${BRANCH} run holds a ${name} artifact, so nothing was restored`);
  return true;
});

if (import.meta.main) runMain(NAME, mutationBaseline);
