import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { writeOutputs } from "./lib/step-output.ts";

const PACK_VARIABLE = "CHECKS_SECRETS_PACK";

class PackMissing extends Schema.TaggedError<PackMissing>()("PackMissing", {
  message: Schema.String,
}) {}

type Target = { readonly pack: string; readonly runnerTemp: string; readonly githubEnv: string };

const writePack = Effect.fn("writePack")(function* ({ pack, runnerTemp, githubEnv }: Target) {
  if (pack === "") {
    return yield* new PackMissing({ message: `secrets-pack needs the pack input, such as \${{ secrets.${PACK_VARIABLE} }}, and it is empty` });
  }
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(runnerTemp, "secrets-pack.json");
  yield* fs.writeFileString(file, pack);
  yield* fs.writeFileString(githubEnv, `${PACK_VARIABLE}=${file}\n`, { flag: "a" });
});

const SKIP_NOTICE = "no private pack is configured, so the steps that read CHECKS_SECRETS_PACK skip";

export type Skip = { readonly stepSummary: string };

const skipPack = Effect.fn("skipPack")(function* ({ stepSummary }: Skip) {
  yield* Console.log(`::notice::${SKIP_NOTICE}`);
  yield* (yield* FileSystem.FileSystem).writeFileString(stepSummary, `${SKIP_NOTICE}\n`, { flag: "a" });
  yield* writeOutputs({ configured: "false" });
});

const IfMissing = Schema.Literals(["fail", "skip"]);

export const main = Effect.gen(function* () {
  const target = yield* Config.all({
    pack: Config.String("PACK").pipe(Config.withDefault("")),
    runnerTemp: Config.String("RUNNER_TEMP"),
    githubEnv: Config.String("GITHUB_ENV"),
  });
  const ifMissing = yield* Config.schema(IfMissing, "IF_MISSING").pipe(Config.withDefault("fail" as const));
  if (target.pack === "" && ifMissing === "skip") {
    yield* skipPack(yield* Config.all({ stepSummary: Config.String("GITHUB_STEP_SUMMARY") }));
    return true;
  }
  yield* writePack(target);
  yield* writeOutputs({ configured: "true" });
  return true;
});
