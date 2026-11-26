import { Config, Console, Effect, Schema } from "effect";
import { commandPasses } from "./lib/run.ts";
import { parseShard } from "../../core/shard.ts";

const CheckRelease = Schema.Literals(["true", "false"]);
const TestTier = Schema.Literals(["unit", "e2e"]);

const isCheckRelease = Schema.is(CheckRelease);

class CheckReleaseUnread extends Schema.TaggedError<CheckReleaseUnread>()("CheckReleaseUnread", {
  message: Schema.String,
}) {}

export type TestCommand = { readonly program: string; readonly args: readonly string[] };

export const testCommandOf = (checkRelease: typeof CheckRelease.Type, tier?: typeof TestTier.Type): TestCommand => {
  const tierArgs = tier === undefined ? [] : [`--tier=${tier}`];
  return checkRelease === "true" ? { program: "bun", args: ["run", "test", ...tierArgs] } : { program: "bunx", args: ["checks-test", "--pr", ...tierArgs] };
};

export const main = Effect.gen(function* () {
  const checkRelease = yield* Config.String("CHECK_RELEASE").pipe(Config.withDefault("false"));
  if (!isCheckRelease(checkRelease)) return yield* new CheckReleaseUnread({ message: `test takes CHECK_RELEASE as true or false, not ${checkRelease}` });
  const tier = yield* Config.String("TEST_TIER").pipe(Config.withDefault(""));
  if (tier !== "" && !Schema.is(TestTier)(tier)) return yield* new CheckReleaseUnread({ message: `test takes TEST_TIER as unit or e2e, not ${tier}` });
  const shard = yield* Config.String("TEST_SHARD").pipe(Config.withDefault(""));
  if (shard !== "" && (tier === "" || parseShard(`--shard=${shard}`) === undefined)) return yield* new CheckReleaseUnread({ message: `test takes TEST_SHARD as index/count with a tier, not ${shard}` });
  const command = testCommandOf(checkRelease, tier === "" ? undefined : tier);
  const { program } = command;
  const args = shard === "" ? command.args : [...command.args, `--shard=${shard}`];
  yield* Console.log(`test: CHECK_RELEASE=${checkRelease}, so this runs ${[program, ...args].join(" ")}`);
  return yield* commandPasses(program, args);
});
