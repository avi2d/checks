import { Config, Effect, FileSystem, Schema } from "effect";

class OutputUnwritable extends Schema.TaggedError<OutputUnwritable>()("OutputUnwritable", {
  message: Schema.String,
}) {}

// GITHUB_OUTPUT reads one name=value per line, so a newline in a value would forge another output.
export const writeOutputs = Effect.fn("writeOutputs")(function* (outputs: Readonly<Record<string, string>>) {
  const entries = Object.entries(outputs);
  const broken = entries.find(([, value]) => value.includes("\n"));
  if (broken !== undefined) return yield* new OutputUnwritable({ message: `the ${broken[0]} output holds a newline` });
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(yield* Config.String("GITHUB_OUTPUT"), entries.map(([name, value]) => `${name}=${value}\n`).join(""), { flag: "a" });
});
