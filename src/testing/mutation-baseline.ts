#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path } from "effect";
import { runMain, Usage } from "../core/main.ts";
import { cacheRoot } from "../dependencies/cache-root.ts";
import { BaselineFailure, gh, pruneFullState } from "./mutation-baseline-full.ts";
import { type Kept, type Missed, pruneReport, pruned } from "./mutation-baseline-report.ts";
import { type Artifact, artifactOf, everyArtifact, fullCandidates, latestCandidates, latestRuns, MAIN_BRANCH, newerThan, type Run, viewedRun } from "./mutation-baseline-runs.ts";
import { INCREMENTAL, LATEST_ARTIFACT, outlived, REPORT, saveBaseline, savedFiles, savedShelf, slimmed } from "./mutation-baseline-saved.ts";

const NAME = "checks-mutation-baseline";
const USAGE =
  "usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest> [incremental-dest] | --save <incremental-src> [mutation-json-src] | --slim <mutation-json-src> <dest> | --prune [--dry-run]";
const REPORT_ALONE = "mutation.json";
const KEPT_PER_ARTIFACT = 2;
const FULL_ARTIFACT = "mutation-baseline-full";
const REFRESH_ARTIFACT = "mutation-refresh-state";

// The first of `from` the artifact holds is copied to `to`.
type Copy = { readonly from: readonly string[]; readonly to: string };

const warned = <A>(fallback: A) => (failure: BaselineFailure) => Console.error(`mutation-baseline: ${failure.message}`).pipe(Effect.as(fallback));

// A successful run uploaded the files, so the newest unexpired artifact is the one the restore takes.
// A failed lookup aborts rather than counting as absent, since that would delete the artifact the restore takes.
const keptArtifact = Effect.fn("keptArtifact")(function* (runs: readonly number[], name: string) {
  for (const run of runs) {
    const artifact = yield* artifactOf(run, name);
    if (Option.isSome(artifact)) return Option.some<Kept>({ run, id: artifact.value.id, name });
  }
  return Option.none<Kept>();
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
  const fullRuns = (yield* fullCandidates(MAIN_BRANCH)).map((run) => run.databaseId);
  const full = yield* keptArtifact(fullRuns, FULL_ARTIFACT);
  const resume = yield* keptArtifact(newerThan(fullRuns, Option.map(full, (kept) => kept.run)), REFRESH_ARTIFACT);
  const artifacts = yield* everyArtifact();
  const keeping = [...Option.toArray(latest.kept), ...Option.toArray(full), ...Option.toArray(resume), ...uploadedBy(artifacts, running)];
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

const BASELINE_ARTIFACTS = new Set([LATEST_ARTIFACT, FULL_ARTIFACT, REFRESH_ARTIFACT]);

const isBaseline = (artifact: Artifact): boolean => BASELINE_ARTIFACTS.has(artifact.name) && !artifact.expired;

// The restore reads only successful runs, so the running run's own uploads join the keepers rather than replace them.
export function uploadedBy(artifacts: readonly Artifact[], running: Option.Option<number>): readonly Kept[] {
  if (Option.isNone(running)) return [];
  return artifacts
    .filter((artifact) => isBaseline(artifact) && artifact.workflow_run.id === running.value)
    .sort((one, other) => one.id - other.id)
    .map((artifact) => ({ run: running.value, id: artifact.id, name: artifact.name }));
}

const prunable = (artifact: Artifact): boolean => isBaseline(artifact) && (artifact.name === LATEST_ARTIFACT || artifact.workflow_run.head_branch === MAIN_BRANCH);

export function superseded(artifacts: readonly Artifact[], kept: ReadonlySet<number>): readonly Artifact[] {
  return artifacts.filter((artifact) => prunable(artifact) && !kept.has(artifact.id)).sort((one, other) => one.id - other.id);
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
    Effect.catchTag("PlatformError", () => Effect.succeed(staged)),
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
    ([report, incremental, ...extra]) =>
      isDestination(report) && (incremental === undefined || isDestination(incremental)) && extra.length === 0
        ? {
            kind: "restore",
            full: true,
            needed: { from: [REPORT_ALONE, REPORT], to: report },
            optional: incremental === undefined ? [] : [{ from: [INCREMENTAL], to: incremental }],
          }
        : undefined,
  ],
]);

function parsed([first, ...rest]: readonly string[]): Command | undefined {
  const flag = first === undefined ? undefined : FLAGS.get(first);
  if (flag !== undefined) return flag(rest);
  const [report, ...extra] = rest;
  return restoreRequest(first, report, extra);
}

const restoredRun = Effect.fn("restoredRun")(function* (run: Run, name: string, root: Option.Option<string>, shelf: Option.Option<string>, request: Request) {
  const state = request.full ? request.optional[0]?.to : request.needed.to;
  if (Option.isSome(shelf) && (yield* restoredFromSaved(shelf.value, run.databaseId, request))) {
    if (state !== undefined) yield* pruneFullState(run, state);
    return true;
  }
  const artifact = yield* artifactOf(run.databaseId, name).pipe(Effect.catch(warned(Option.none<Artifact>())));
  if (Option.isNone(artifact) || !(yield* restoredFrom(run.databaseId, artifact.value, root, request))) return false;
  if (state !== undefined) yield* pruneFullState(run, state);
  return true;
});

const stateRequest = (to: string): Request => ({ kind: "restore", full: false, needed: { from: [INCREMENTAL], to }, optional: [] });

const restoredFullRun = Effect.fn("restoredFullRun")(function* (runs: readonly Run[], request: Request, root: Option.Option<string>) {
  for (const run of runs) {
    if (yield* restoredRun(run, FULL_ARTIFACT, root, Option.none<string>(), request)) return Option.some(run.databaseId);
  }
  return Option.none<number>();
});

// Restoring straight into the destination would let a state the prune drops delete the state restored before it.
const resumedState = Effect.fn("resumedState")(
  function* (runs: readonly Run[], full: Option.Option<number>, state: string, root: Option.Option<string>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staged = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "mutation-state-" }), INCREMENTAL);
    const eligible = newerThan(runs.map((run) => run.databaseId), full);
    for (const run of runs.slice(0, eligible.length)) {
      if (!(yield* restoredRun(run, REFRESH_ARTIFACT, root, Option.none<string>(), stateRequest(staged)))) continue;
      if (!(yield* fs.exists(staged))) return false;
      yield* fs.makeDirectory(path.dirname(state), { recursive: true });
      yield* fs.copyFile(staged, state);
      return true;
    }
    return false;
  },
  Effect.scoped,
);

const searchFull = Effect.fn("searchFull")(function* (branch: string, request: Request, root: Option.Option<string>) {
  const runs = yield* fullCandidates(branch);
  return { runs, full: yield* restoredFullRun(runs, request, root) };
});

const absentReport = Console.log(`mutation-baseline: no successful ${MAIN_BRANCH} run holds a ${FULL_ARTIFACT} artifact, so no report was restored`);

const preferredReport = Effect.fn("preferredReport")(function* (branch: string, request: Request, root: Option.Option<string>) {
  const selected = yield* searchFull(branch, request, root);
  if (Option.isSome(selected.full)) return { selected };
  const fallback = branch === MAIN_BRANCH ? undefined : yield* searchFull(MAIN_BRANCH, request, root);
  if (fallback === undefined || Option.isNone(fallback.full)) yield* absentReport;
  return { selected, fallback };
});

const restoreNamed = Effect.fn("restoreNamed")(function* (id: string, branch: string, request: Request, root: Option.Option<string>) {
  const state = request.optional[0]?.to;
  if (state === undefined) return yield* new BaselineFailure({ message: "CHECKS_MUTATION_RESUME_RUN_ID needs an incremental destination" });
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return yield* new BaselineFailure({ message: "CHECKS_MUTATION_RESUME_RUN_ID must be a positive run ID" });
  }
  const run = yield* viewedRun(id);
  if (!(yield* restoredRun(run, REFRESH_ARTIFACT, root, Option.none<string>(), stateRequest(state)))) {
    return yield* new BaselineFailure({ message: `run ${id} holds no stopped mutation state` });
  }
  yield* preferredReport(branch, { ...request, optional: [] }, root);
  return true;
});

const restoreFull = Effect.fn("restoreFull")(function* (request: Request) {
  const root = yield* runnerCache;
  const branch = yield* Config.String("CHECKS_MUTATION_BRANCH").pipe(Config.withDefault(MAIN_BRANCH));
  const named = yield* Config.String("CHECKS_MUTATION_RESUME_RUN_ID").pipe(Config.withDefault(""));
  if (named !== "") return yield* restoreNamed(named, branch, request, root);
  const { selected, fallback } = yield* preferredReport(branch, request, root);
  const state = request.optional[0]?.to;
  if (state !== undefined && !(yield* resumedState(selected.runs, selected.full, state, root)) && fallback !== undefined) {
    yield* resumedState(fallback.runs, fallback.full, state, root);
  }
  return true;
});

const restoreBaseline = Effect.fn("restoreBaseline")(function* (request: Request) {
  if (request.full) return yield* restoreFull(request);
  const root = yield* runnerCache;
  const shelf = yield* savedShelf(root);
  for (const run of yield* latestCandidates) {
    if (yield* restoredRun(run, LATEST_ARTIFACT, root, shelf, request)) return true;
  }
  yield* Console.log(`mutation-baseline: no successful ${MAIN_BRANCH} run holds a ${LATEST_ARTIFACT} artifact, so nothing was restored`);
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
