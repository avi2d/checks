import { Config, Console, Data, Effect, FileSystem, Option, Path, Schema } from "effect";
import { commandExit, commandOutput } from "../lib/run.ts";
import { anyStopped, DOWNLOADED_DIRECTORY, Report, scoreSummary, SHARD_DIRECTORY, shardsOf, STATE_PREFIX, stateName, stoppedName } from "./report.ts";

class MutationStepError extends Data.TaggedError("MutationStepError")<{ readonly message: string }> {}

const MERGED_REPORT = "reports/mutation/mutation.json";
const INCREMENTAL_STATE = "reports/stryker-incremental.json";
const STRYKER = "node_modules/.bin/stryker";
const STOP_MINUTES = 30;
const TIMED_OUT = 124;

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Report));

const readReport = Effect.fn("readReport")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return undefined;
  return yield* decodeReport(yield* fs.readFileString(file)).pipe(
    Effect.mapError(() => new MutationStepError({ message: `${file} is not a mutation report` })),
  );
});

const appendTo = Effect.fn("appendTo")(function* (variable: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(yield* Config.String(variable), text, { flag: "a" });
});

const score = Effect.gen(function* () {
  yield* appendTo("GITHUB_STEP_SUMMARY", scoreSummary("mutation refresh", yield* readReport(MERGED_REPORT)));
});

const shards = Effect.gen(function* () {
  const count = yield* Config.Int("SHARDS");
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const lastFull = path.join(yield* Config.String("RUNNER_TEMP"), "last-full", "mutation.json");
  const lastState = path.join(path.dirname(lastFull), "stryker-incremental.json");
  const known = (yield* fs.exists(lastFull)) ? [lastFull, ...((yield* fs.exists(lastState)) ? [lastState] : [])] : [];
  const args = ["checks-mutation-scope", "--shards", String(count), ...known];
  const { stdout, passed } = yield* commandOutput("bunx", args);
  if (!passed) return yield* new MutationStepError({ message: `bunx ${args.join(" ")} failed` });
  const line = shardsOf(stdout);
  if (line === undefined) return yield* new MutationStepError({ message: "checks-mutation-scope printed no SHARDS= line" });
  yield* appendTo("GITHUB_OUTPUT", `shards=${line}\n`);
});

// timeout sends TERM straight to the Stryker binary, which saves a partial incremental state on it, while the runner's own cancel saves nothing.
const shard = Effect.gen(function* () {
  const mutate = yield* Config.String("SHARD");
  const index = yield* Config.String("INDEX");
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const previousModified = (yield* fs.exists(INCREMENTAL_STATE)) ? Option.getOrUndefined((yield* fs.stat(INCREMENTAL_STATE)).mtime)?.getTime() : undefined;
  const exit = yield* commandExit("timeout", ["-s", "TERM", `${STOP_MINUTES}m`, STRYKER, "run", "--incremental", "--mutate", mutate]);
  const stopped = exit === TIMED_OUT;
  if (exit !== 0 && !stopped) return yield* new MutationStepError({ message: `stryker exited ${exit}` });
  const modified = (yield* fs.exists(INCREMENTAL_STATE)) ? Option.getOrUndefined((yield* fs.stat(INCREMENTAL_STATE)).mtime)?.getTime() : undefined;
  if (modified === undefined || modified === previousModified) return yield* new MutationStepError({ message: `stryker wrote no new ${INCREMENTAL_STATE}, so shard ${index} has no state to hand on` });
  yield* fs.makeDirectory(SHARD_DIRECTORY, { recursive: true });
  yield* fs.copyFile(INCREMENTAL_STATE, path.join(SHARD_DIRECTORY, stateName(index)));
  if (stopped) {
    yield* fs.writeFileString(path.join(SHARD_DIRECTORY, stoppedName(index)), "stopped\n");
    yield* Console.log(`::notice::shard ${index} stopped after ${STOP_MINUTES} minutes, so the next run resumes it`);
  }
});

const finished = Effect.gen(function* () {
  const names = yield* (yield* FileSystem.FileSystem).readDirectory(DOWNLOADED_DIRECTORY);
  if (!names.some((name) => name.startsWith(STATE_PREFIX))) return yield* new MutationStepError({ message: `${DOWNLOADED_DIRECTORY} holds no shard state` });
  yield* appendTo("GITHUB_OUTPUT", `finished=${String(!anyStopped(names))}\n`);
});

const PARTS = { score, shards, shard, finished };

const isPart = (part: string): part is keyof typeof PARTS => Object.hasOwn(PARTS, part);

export const main = Effect.fn("mutation")(function* (part: string | undefined) {
  if (part === undefined || !isPart(part)) {
    return yield* new MutationStepError({ message: `checks-ci mutation takes one of ${Object.keys(PARTS).join(", ")}, not ${part ?? "nothing"}` });
  }
  yield* PARTS[part];
  return true;
});
