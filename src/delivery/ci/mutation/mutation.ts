import { Config, Data, Effect, FileSystem, Path, Schema } from "effect";
import { commandOutput } from "../lib/run.ts";
import { Report, scoreSummary, shardsOf } from "./report.ts";

class MutationStepError extends Data.TaggedError("MutationStepError")<{ readonly message: string }> {}

const MERGED_REPORT = "reports/mutation/mutation.json";

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
  const lastFull = path.join(yield* Config.String("RUNNER_TEMP"), "last-full", "mutation.json");
  const known = (yield* (yield* FileSystem.FileSystem).exists(lastFull)) ? [lastFull] : [];
  const args = ["checks-mutation-scope", "--shards", String(count), ...known];
  const { stdout, passed } = yield* commandOutput("bunx", args);
  if (!passed) return yield* new MutationStepError({ message: `bunx ${args.join(" ")} failed` });
  const line = shardsOf(stdout);
  if (line === undefined) return yield* new MutationStepError({ message: "checks-mutation-scope printed no SHARDS= line" });
  yield* appendTo("GITHUB_OUTPUT", `shards=${line}\n`);
});

const PARTS = { score, shards };

const isPart = (part: string): part is keyof typeof PARTS => Object.hasOwn(PARTS, part);

export const main = Effect.fn("mutation")(function* (part: string | undefined) {
  if (part === undefined || !isPart(part)) {
    return yield* new MutationStepError({ message: `checks-ci mutation takes one of ${Object.keys(PARTS).join(", ")}, not ${part ?? "nothing"}` });
  }
  yield* PARTS[part];
  return true;
});
