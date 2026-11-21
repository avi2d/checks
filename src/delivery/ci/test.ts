import { Config, Console, Effect, Schema } from "effect";
import { commandPasses } from "./lib/run.ts";

const CheckRelease = Schema.Literals(["true", "false"]);

const isCheckRelease = Schema.is(CheckRelease);

class CheckReleaseUnread extends Schema.TaggedError<CheckReleaseUnread>()("CheckReleaseUnread", {
  message: Schema.String,
}) {}

export type TestCommand = { readonly program: string; readonly args: readonly string[] };

export const testCommandOf = (checkRelease: typeof CheckRelease.Type): TestCommand =>
  checkRelease === "true" ? { program: "bun", args: ["run", "test"] } : { program: "bunx", args: ["checks-test", "--pr"] };

export const main = Effect.gen(function* () {
  const checkRelease = yield* Config.String("CHECK_RELEASE").pipe(Config.withDefault("false"));
  if (!isCheckRelease(checkRelease)) return yield* new CheckReleaseUnread({ message: `test takes CHECK_RELEASE as true or false, not ${checkRelease}` });
  const { program, args } = testCommandOf(checkRelease);
  yield* Console.log(`test: CHECK_RELEASE=${checkRelease}, so this runs ${[program, ...args].join(" ")}`);
  return yield* commandPasses(program, args);
});
