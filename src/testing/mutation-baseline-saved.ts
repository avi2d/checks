import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { cacheRoot } from "../dependencies/cache-root.ts";

export const LATEST_ARTIFACT = "mutation-baseline";
export const INCREMENTAL = "stryker-incremental.json";
export const REPORT = "mutation/mutation.json";
const SAVED = "saved";

class SaveFailure extends Schema.TaggedError<SaveFailure>()("SaveFailure", {
  message: Schema.String,
}) {}

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const SavedFiles = Schema.Struct({ [INCREMENTAL]: Schema.Unknown, [REPORT]: Schema.optionalKey(Schema.Unknown) });
export type SavedFiles = typeof SavedFiles.Type;
const decodeSavedFiles = Schema.decodeUnknownEffect(Schema.fromJsonString(SavedFiles));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const withoutReason = (mutant: unknown): unknown => (isRecord(mutant) ? Object.fromEntries(Object.entries(mutant).filter(([key]) => key !== "statusReason")) : mutant);

function slimFile(file: unknown): unknown {
  if (!isRecord(file)) return file;
  const mutants = file["mutants"];
  return Array.isArray(mutants) ? { ...file, mutants: mutants.map((mutant: unknown) => withoutReason(mutant)) } : file;
}

// statusReason holds the test runner's failure message for each mutant, which no reader of a baseline uses and which fills most of a large report.
export function withoutReasons(report: unknown): unknown {
  if (!isRecord(report) || !isRecord(report["files"])) return report;
  return { ...report, files: Object.fromEntries(Object.entries(report["files"]).map(([name, file]) => [name, slimFile(file)])) };
}

const slimOf = Effect.fn("slimOf")(function* (from: string) {
  const report = yield* (yield* FileSystem.FileSystem).readFileString(from).pipe(
    Effect.flatMap(decodeReport),
    Effect.mapError((cause) => new SaveFailure({ message: `cannot read ${from}: ${cause.message}` })),
  );
  return withoutReasons(report);
});

export type Invalidation = { readonly tests: ReadonlySet<string>; readonly sources: ReadonlySet<string> };

export type Invalidated = { readonly state: unknown; readonly tests: readonly string[]; readonly sources: readonly string[] };

export function withoutStale(state: unknown, invalidation: Invalidation): Invalidated {
  const kept: Invalidated = { state, tests: [], sources: [] };
  if (!isRecord(state)) return kept;
  const testFiles = isRecord(state["testFiles"]) ? state["testFiles"] : undefined;
  const files = isRecord(state["files"]) ? state["files"] : undefined;
  if (testFiles === undefined && files === undefined) return kept;
  const owners = new Map<string, string>();
  if (testFiles !== undefined) {
    for (const [file, entry] of Object.entries(testFiles)) {
      const listed = isRecord(entry) && Array.isArray(entry["tests"]) ? entry["tests"] : [];
      for (const one of listed) {
        if (isRecord(one) && typeof one["id"] === "string") owners.set(one["id"], file);
      }
    }
  }
  const freshTest = (id: unknown): boolean => {
    if (typeof id !== "string") return false;
    const owner = owners.get(id);
    return owner !== undefined && !invalidation.tests.has(owner);
  };
  const coveredFresh = (mutant: unknown): boolean => {
    if (!isRecord(mutant)) return false;
    const refs = [...(Array.isArray(mutant["coveredBy"]) ? mutant["coveredBy"] : []), ...(Array.isArray(mutant["killedBy"]) ? mutant["killedBy"] : [])];
    return refs.length > 0 && refs.every(freshTest);
  };
  const isKilled = (mutant: unknown): boolean => isRecord(mutant) && mutant["status"] === "Killed";
  const tests = testFiles === undefined ? [] : Object.keys(testFiles).filter((file) => invalidation.tests.has(file));
  const sources: string[] = [];
  let nextFiles: Record<string, unknown> | undefined;
  if (files !== undefined) {
    nextFiles = {};
    for (const [name, file] of Object.entries(files)) {
      if (!isRecord(file) || !Array.isArray(file["mutants"])) {
        nextFiles[name] = file;
        continue;
      }
      const before: unknown[] = file["mutants"];
      const mutants = invalidation.sources.has(name) ? [] : invalidation.tests.size === 0 ? before : before.filter((mutant) => isKilled(mutant) || coveredFresh(mutant));
      if (mutants.length < before.length) sources.push(name);
      if (mutants.length > 0) nextFiles[name] = { ...file, mutants };
    }
  }
  if (tests.length === 0 && sources.length === 0) return kept;
  return {
    state: {
      ...state,
      ...(testFiles === undefined
        ? {}
        : { testFiles: Object.fromEntries(Object.entries(testFiles).filter(([file]) => !invalidation.tests.has(file))) }),
      ...(nextFiles === undefined ? {} : { files: nextFiles }),
    },
    tests: tests.toSorted(),
    sources: sources.toSorted(),
  };
}

export const slimmed = Effect.fn("slimmed")(function* (from: string, to: string) {
  const fs = yield* FileSystem.FileSystem;
  const report = yield* slimOf(from);
  yield* fs.makeDirectory((yield* Path.Path).dirname(to), { recursive: true });
  yield* fs.writeFileString(to, JSON.stringify(report));
});

const shelfOf = Effect.fn("shelfOf")(function* (root: string, repository: number) {
  return (yield* Path.Path).join(root, "mutation-baseline", String(repository), SAVED, LATEST_ARTIFACT);
});

// GitHub sets GITHUB_REPOSITORY_ID on every job, so a run outside Actions has no saved baselines.
export const savedShelf = Effect.fn("savedShelf")(function* (root: Option.Option<string>) {
  const repository = yield* Config.Int("GITHUB_REPOSITORY_ID").pipe(Config.option);
  if (Option.isNone(root) || Option.isNone(repository)) return Option.none<string>();
  return Option.some(yield* shelfOf(root.value, repository.value));
});

const savedEntry = Effect.fn("savedEntry")(function* (shelf: string, run: number) {
  return (yield* Path.Path).join(shelf, `${run}.json`);
});

// One read opens the entry once, so a job that removes or replaces it afterwards leaves what this job read whole.
export const savedFiles = Effect.fn("savedFiles")(function* (shelf: string, run: number) {
  const entry = yield* savedEntry(shelf, run);
  const text = yield* (yield* FileSystem.FileSystem).readFileString(entry).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
  );
  if (Option.isNone(text)) return Option.none<SavedFiles>();
  return Option.some(yield* decodeSavedFiles(text.value).pipe(Effect.mapError((cause) => new SaveFailure({ message: `cannot read ${entry}: ${cause.message}` }))));
});

// GitHub numbers runs in the order it creates them, so a lower id is an older run the restore never reads again.
export function outlived(entries: readonly string[], restoring: number): readonly string[] {
  return entries.filter((entry) => {
    const run = /^(\d+)\.json$/.exec(entry)?.[1];
    return run !== undefined && Number(run) < restoring;
  });
}

const required = (name: string) =>
  Config.Int(name).pipe(Effect.mapError(() => new SaveFailure({ message: `${name} is unset, so --save runs only inside a GitHub Actions job` })));

// The entry is one file renamed into place, so a job sharing the runner reads one attempt's entry whole even while a re-run replaces it.
export const saveBaseline = Effect.fn("saveBaseline")(function* (incremental: string, report: Option.Option<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Config.String("RUNNER_ENVIRONMENT").pipe(Config.withDefault(""));
  if (environment === "github-hosted") {
    return yield* new SaveFailure({ message: "a GitHub-hosted runner discards its disk when the job ends, so upload the baseline as an artifact there" });
  }
  const root = yield* cacheRoot().pipe(Effect.mapError((cause) => new SaveFailure({ message: cause.message })));
  const shelf = yield* shelfOf(root, yield* required("GITHUB_REPOSITORY_ID"));
  const run = yield* required("GITHUB_RUN_ID");
  const files: SavedFiles = { [INCREMENTAL]: yield* slimOf(incremental), ...(Option.isSome(report) ? { [REPORT]: yield* slimOf(report.value) } : {}) };
  yield* fs.makeDirectory(shelf, { recursive: true });
  const staged = path.join(yield* fs.makeTempDirectoryScoped({ directory: shelf, prefix: ".staging-" }), "entry.json");
  yield* fs.writeFileString(staged, JSON.stringify(files));
  yield* fs.rename(staged, yield* savedEntry(shelf, run));
  yield* Console.log(`mutation-baseline: saved the ${LATEST_ARTIFACT} of run ${run} on the runner's disk`);
  return true;
}, Effect.scoped);
