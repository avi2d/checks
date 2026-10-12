#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";
import { INCREMENTAL, LATEST_ARTIFACT, outlived, REPORT, saveBaseline, savedFiles, savedShelf, slimmed } from "./mutation-baseline-saved.ts";

class BaselineFailure extends Schema.TaggedError<BaselineFailure>()("BaselineFailure", {
  message: Schema.String,
}) {}

const NAME = "checks-mutation-baseline";
const USAGE =
  "usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest> | --save <incremental-src> [mutation-json-src] | --slim <mutation-json-src> <dest> | --prune [--dry-run]";
const WORKFLOW = "mutation.yml";
const BRANCH = "main";
const REPORT_ALONE = "mutation.json";
const KEPT_PER_ARTIFACT = 2;
const FULL_ARTIFACT = "mutation-baseline-full";
const LATEST_LIMIT = 20;
const FULL_LIMIT = 50;
const PAGE_SIZE = 100;
const FULL_EVENTS = ["schedule", "workflow_dispatch"];

// The first of `from` the artifact holds is copied to `to`.
type Copy = { readonly from: readonly string[]; readonly to: string };

const Run = Schema.Struct({ databaseId: Schema.Int, event: Schema.String, createdAt: Schema.String });
type Run = typeof Run.Type;

const Artifact = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  expired: Schema.Boolean,
  workflow_run: Schema.Struct({ id: Schema.Int, repository_id: Schema.Int }),
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

// All non-pull-request runs newest first: a newer full run holds no baseline, and the newest baseline must survive it.
const latestCandidates = Effect.gen(function* () {
  const newest = (yield* listed(undefined, LATEST_LIMIT)).find((run) => run.event !== "pull_request");
  return newest === undefined ? [] : [newest.databaseId];
});

const latestRuns = listed(undefined, LATEST_LIMIT).pipe(Effect.map((runs) => newestFirst(runs.filter((run) => run.event !== "pull_request"))));

// Each full event is listed on its own, because one shared window lets push runs crowd out every full run.
const fullCandidates = Effect.gen(function* () {
  const perEvent = yield* Effect.forEach(FULL_EVENTS, (event) => listed(event, FULL_LIMIT));
  return newestFirst(perEvent.flat());
});

// A successful run uploaded the files, so the newest unexpired artifact is the one the restore takes.
// A failed lookup aborts rather than counting as absent, since that would delete the artifact the restore takes.
const keptArtifact = Effect.fn("keptArtifact")(function* (runs: readonly number[], name: string) {
  for (const run of runs) {
    const artifact = yield* artifactOf(run, name);
    if (Option.isSome(artifact)) return Option.some<Kept>({ run, id: artifact.value.id, name });
  }
  return Option.none<Kept>();
});

const everyArtifact = Effect.fn("everyArtifact")(function* () {
  const artifacts: Artifact[] = [];
  let page = 1;
  while (true) {
    const batch = yield* gh(["api", `repos/{owner}/{repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`]).pipe(
      Effect.flatMap(decodeArtifacts),
      Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
    );
    artifacts.push(...batch.artifacts);
    if (batch.artifacts.length < PAGE_SIZE) return artifacts;
    page += 1;
  }
});

const missedDeletion = Effect.fn("missedDeletion")(function* (artifact: Artifact) {
  return yield* gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/actions/artifacts/${artifact.id}`]).pipe(
    Effect.as(Option.none<Missed>()),
    Effect.catch((failure) => Effect.succeedSome<Missed>({ id: artifact.id, name: artifact.name, error: failure.message })),
  );
});

// A run whose baseline the runner's disk holds supersedes every older artifact, since the restore reads that run's entry first.
const keptLatest = Effect.fn("keptLatest")(function* (runs: readonly number[], shelf: Option.Option<string>) {
  for (const run of runs) {
    if (Option.isSome(shelf) && Option.isSome(yield* savedFiles(shelf.value, run))) return { saved: Option.some(run), kept: Option.none<Kept>() };
    const artifact = yield* artifactOf(run, LATEST_ARTIFACT);
    if (Option.isSome(artifact)) return { saved: Option.none<number>(), kept: Option.some<Kept>({ run, id: artifact.value.id, name: LATEST_ARTIFACT }) };
  }
  return { saved: Option.none<number>(), kept: Option.none<Kept>() };
});

const pruneBaselines = Effect.fn("pruneBaselines")(function* (dryRun: boolean) {
  const running = yield* Config.Int("GITHUB_RUN_ID").pipe(Config.option);
  const latest = yield* keptLatest(yield* latestRuns, yield* savedShelf(yield* runnerCache));
  const full = yield* keptArtifact(yield* fullCandidates, FULL_ARTIFACT);
  const artifacts = yield* everyArtifact();
  const keeping = [...Option.toArray(latest.kept), ...Option.toArray(full), ...uploadedBy(artifacts, running)];
  const victims = superseded(artifacts, new Set(keeping.map((keep) => keep.id)));
  const removed: number[] = [];
  const missed: Missed[] = [];
  if (!dryRun) {
    for (const victim of victims) {
      const failed = yield* missedDeletion(victim);
      if (Option.isSome(failed)) missed.push(failed.value);
      else removed.push(victim.id);
    }
  }
  yield* Console.log(pruneReport(dryRun, dryRun ? victims.map((victim) => victim.id) : removed, missed, keeping, latest.saved));
  return true;
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

export type Kept = { readonly run: number; readonly id: number; readonly name: string };

export type Missed = { readonly id: number; readonly name: string; readonly error: string };

const isBaseline = (artifact: Artifact): boolean => (artifact.name === LATEST_ARTIFACT || artifact.name === FULL_ARTIFACT) && !artifact.expired;

// The restore reads only successful runs, so the running run's own uploads join the keepers rather than replace them.
export function uploadedBy(artifacts: readonly Artifact[], running: Option.Option<number>): readonly Kept[] {
  if (Option.isNone(running)) return [];
  return artifacts
    .filter((artifact) => isBaseline(artifact) && artifact.workflow_run.id === running.value)
    .sort((one, other) => one.id - other.id)
    .map((artifact) => ({ run: running.value, id: artifact.id, name: artifact.name }));
}

export function superseded(artifacts: readonly Artifact[], kept: ReadonlySet<number>): readonly Artifact[] {
  return artifacts.filter((artifact) => isBaseline(artifact) && !kept.has(artifact.id)).sort((one, other) => one.id - other.id);
}

// A workflow command ends at a newline, so the error's own newlines and percent signs are escaped.
const annotated = (text: string): string => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

export function pruneReport(dryRun: boolean, removed: readonly number[], missed: readonly Missed[], keeping: readonly Kept[], saved: Option.Option<number>): string {
  const holdings = [
    ...keeping.map((keep) => `${keep.name} artifact ${keep.id} from run ${keep.run}`),
    ...Option.toArray(saved).map((run) => `the ${LATEST_ARTIFACT} run ${run} saved on the runner's disk`),
  ];
  const kept = holdings.length === 0 ? "no baseline artifacts" : holdings.join(", ");
  const deleted = removed.length === 0 ? "nothing to delete" : `deleted artifacts ${removed.join(", ")}`;
  if (dryRun) return `mutation-baseline: dry run, ${removed.length === 0 ? "nothing to delete" : `would delete artifacts ${removed.join(", ")}`}; would keep ${kept}`;
  if (missed.length === 0) return `mutation-baseline: ${deleted}; kept ${kept}`;
  const warnings = missed.map((miss) => `::warning::mutation-baseline: could not delete ${miss.name} artifact ${miss.id}: ${annotated(miss.error)}`);
  return [...warnings, `mutation-baseline: ${deleted}; kept ${kept}; could not delete artifacts ${missed.map((miss) => miss.id).join(", ")}`].join("\n");
}

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

const restoredFromSaved = Effect.fn("restoredFromSaved")(function* (shelf: string, run: number, request: Request) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* savedFiles(shelf, run);
  if (Option.isNone(files)) return false;
  const stored = new Map(Object.entries(files.value));
  for (const copy of [request.needed, ...request.optional]) {
    const name = copy.from.find((from) => stored.has(from));
    if (name === undefined) continue;
    yield* fs.makeDirectory(path.dirname(copy.to), { recursive: true });
    yield* fs.writeFileString(copy.to, JSON.stringify(stored.get(name)));
  }
  for (const older of outlived(yield* fs.readDirectory(shelf), run)) {
    yield* fs.remove(path.join(shelf, older), { force: true });
  }
  yield* Console.log(`mutation-baseline: restored it from the runner's disk, ${LATEST_ARTIFACT} saved by run ${run}`);
  return true;
});

const slimReport = Effect.fn("slimReport")(function* (from: string, to: string) {
  const fs = yield* FileSystem.FileSystem;
  const before = (yield* fs.stat(from)).size;
  yield* slimmed(from, to);
  const after = (yield* fs.stat(to)).size;
  yield* Console.log(`mutation-baseline: wrote ${to} without statusReason, ${after} bytes from ${before}`);
  return true;
});

// An artifact that lacks `needed` counts as no baseline, and `optional` copies only what the artifact holds.
type Request = { readonly kind: "restore"; readonly full: boolean; readonly needed: Copy; readonly optional: readonly Copy[] };

type Command =
  | Request
  | { readonly kind: "prune"; readonly dryRun: boolean }
  | { readonly kind: "save"; readonly incremental: string; readonly report: Option.Option<string> }
  | { readonly kind: "slim"; readonly from: string; readonly to: string };

const isDestination = (arg: string | undefined): arg is string => arg !== undefined && !arg.startsWith("-");

function restoreRequest(incremental: string | undefined, report: string | undefined, extra: readonly string[]): Command | undefined {
  if (!isDestination(incremental) || extra.length > 0) return undefined;
  return { kind: "restore", full: false, needed: { from: [INCREMENTAL], to: incremental }, optional: report === undefined ? [] : [{ from: [REPORT], to: report }] };
}

const FLAGS = new Map<string, (rest: readonly string[]) => Command | undefined>([
  ["--prune", ([flag, ...extra]) => ((flag === undefined || flag === "--dry-run") && extra.length === 0 ? { kind: "prune", dryRun: flag !== undefined } : undefined)],
  [
    "--save",
    ([incremental, report, ...extra]) =>
      isDestination(incremental) && (report === undefined || isDestination(report)) && extra.length === 0
        ? { kind: "save", incremental, report: Option.fromNullishOr(report) }
        : undefined,
  ],
  ["--slim", ([from, to, ...extra]) => (isDestination(from) && isDestination(to) && extra.length === 0 ? { kind: "slim", from, to } : undefined)],
  [
    "--full",
    ([report, ...extra]) =>
      isDestination(report) && extra.length === 0 ? { kind: "restore", full: true, needed: { from: [REPORT_ALONE, REPORT], to: report }, optional: [] } : undefined,
  ],
]);

function parsed([first, ...rest]: readonly string[]): Command | undefined {
  const flag = first === undefined ? undefined : FLAGS.get(first);
  if (flag !== undefined) return flag(rest);
  const [report, ...extra] = rest;
  return restoreRequest(first, report, extra);
}

const restoreBaseline = Effect.fn("restoreBaseline")(function* (request: Request) {
  const name = request.full ? FULL_ARTIFACT : LATEST_ARTIFACT;
  const root = yield* runnerCache;
  const shelf = request.full ? Option.none<string>() : yield* savedShelf(root);
  for (const run of yield* request.full ? fullCandidates : latestCandidates) {
    if (Option.isSome(shelf) && (yield* restoredFromSaved(shelf.value, run, request))) return true;
    const artifact = yield* artifactOf(run, name).pipe(Effect.catch(warned(Option.none<Artifact>())));
    if (Option.isSome(artifact) && (yield* restoredFrom(run, artifact.value, root, request))) return true;
  }
  yield* Console.log(`mutation-baseline: no successful ${BRANCH} run holds a ${name} artifact, so nothing was restored`);
  return true;
});

const mutationBaseline = Effect.gen(function* () {
  const command = parsed(process.argv.slice(2));
  if (command === undefined) return yield* new Usage({ message: USAGE });
  if (command.kind === "prune") return yield* pruneBaselines(command.dryRun);
  if (command.kind === "save") return yield* saveBaseline(command.incremental, command.report);
  if (command.kind === "slim") return yield* slimReport(command.from, command.to);
  return yield* restoreBaseline(command);
});

if (import.meta.main) runMain(NAME, mutationBaseline);
