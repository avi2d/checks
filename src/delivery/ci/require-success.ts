import { Console, Data, Effect, Schema } from "effect";
import { optionalInput } from "./lib/inputs.ts";

class RequireSuccessError extends Data.TaggedError("RequireSuccessError")<{ readonly message: string }> {}

const wordsOf = (text: string) => text.split(/\s+/).filter((word) => word !== "");

const Needs = Schema.Record(Schema.String, Schema.Struct({ result: Schema.String }));
const decodeNeeds = Schema.decodeUnknownEffect(Schema.fromJsonString(Needs));

// toJSON(needs) is an object, and the name=result form never starts with a brace.
const resultPairs = Effect.fn("resultPairs")(function* (results: string) {
  if (!results.trimStart().startsWith("{")) return wordsOf(results);
  const needs = yield* decodeNeeds(results).pipe(
    Effect.mapError((issue) => new RequireSuccessError({ message: `require-success cannot read results as toJSON(needs): ${issue.message}` })),
  );
  return Object.entries(needs).map(([name, need]) => `${name}=${need.result}`);
});

const skipPair = (word: string) => (word.includes("=") ? word : `${word}=true`);

export function passes(pair: string, expectedSkips: ReadonlySet<string>): boolean {
  const separator = pair.indexOf("=");
  const result = pair.slice(separator + 1);
  return result === "success" || (result === "skipped" && expectedSkips.has(`${pair.slice(0, separator)}=true`));
}

export const main = Effect.gen(function* () {
  const results = yield* resultPairs(yield* optionalInput("RESULTS"));
  const expectedSkips = new Set(wordsOf(yield* optionalInput("SKIPS")).map(skipPair));
  if (results.length === 0) return yield* new RequireSuccessError({ message: "require-success needs at least one name=result in results" });
  const bare = results.find((pair) => !pair.includes("="));
  if (bare !== undefined) return yield* new RequireSuccessError({ message: `require-success takes name=result pairs, not '${bare}'` });
  const failed = results.filter((pair) => !passes(pair, expectedSkips));
  if (failed.length > 0) return yield* new RequireSuccessError({ message: `${failed.join(" ")}, where each result must be success, or skipped where skips names it true` });
  yield* Console.log(results.join(" "));
});
