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

export const slimmed = Effect.fn("slimmed")(function* (from: string, to: string) {
  const fs = yield* FileSystem.FileSystem;
  const report = yield* fs.readFileString(from).pipe(
    Effect.flatMap(decodeReport),
    Effect.mapError((cause) => new SaveFailure({ message: `cannot read ${from}: ${cause.message}` })),
  );
  yield* fs.makeDirectory((yield* Path.Path).dirname(to), { recursive: true });
  yield* fs.writeFileString(to, JSON.stringify(withoutReasons(report)));
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

export const savedEntry = Effect.fn("savedEntry")(function* (shelf: string, run: number) {
  return (yield* Path.Path).join(shelf, String(run));
});

// GitHub numbers runs in the order it creates them, so a lower id is an older run the restore never reads again.
// Only a successful run's entry is a spare, since a failed run's is one no restore reads.
export function outlived(entries: readonly string[], restoring: number, successful: readonly number[], spares: number): readonly string[] {
  const older = entries
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number)
    .filter((run) => run < restoring)
    .sort((one, other) => other - one);
  const kept = new Set(older.filter((run) => successful.includes(run)).slice(0, spares));
  return older.filter((run) => !kept.has(run)).map(String);
}

const required = (name: string) =>
  Config.Int(name).pipe(Effect.mapError(() => new SaveFailure({ message: `${name} is unset, so --save runs only inside a GitHub Actions job` })));

// The entry lands through a rename beside it, so a job sharing the runner sees it whole or not at all.
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
  const entry = yield* savedEntry(shelf, run);
  // A re-run attempt runs the same commit, and a job sharing the runner may be copying from the entry an earlier attempt saved.
  if (yield* fs.exists(entry)) {
    yield* Console.log(`mutation-baseline: kept the ${LATEST_ARTIFACT} an earlier attempt of run ${run} saved on the runner's disk`);
    return true;
  }
  yield* fs.makeDirectory(shelf, { recursive: true });
  const staged = path.join(yield* fs.makeTempDirectoryScoped({ directory: shelf, prefix: ".staging-" }), "entry");
  yield* slimmed(incremental, path.join(staged, INCREMENTAL));
  if (Option.isSome(report)) yield* slimmed(report.value, path.join(staged, REPORT));
  yield* fs.rename(staged, entry);
  yield* Console.log(`mutation-baseline: saved the ${LATEST_ARTIFACT} of run ${run} on the runner's disk`);
  return true;
}, Effect.scoped);
