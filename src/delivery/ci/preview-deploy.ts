import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { accountFromEnv } from "./lib/cloudflare.ts";
import { requiredInput } from "./lib/inputs.ts";
import { commandPasses } from "./lib/run.ts";
import { deployArgs, deployedAlias, deployFromEnv } from "./lib/wrangler.ts";

const ACTION = "preview-deploy";

class AliasMismatch extends Schema.TaggedError<AliasMismatch>()("AliasMismatch", {
  message: Schema.String,
}) {}

export const main = Effect.gen(function* () {
  yield* accountFromEnv(ACTION);
  const deploy = yield* deployFromEnv(ACTION);
  const origin = yield* requiredInput(ACTION, "origin", "ORIGIN");
  const fs = yield* FileSystem.FileSystem;
  const outputFile = (yield* Path.Path).join(yield* Config.String("RUNNER_TEMP"), "preview-deploy-output.ndjson");
  // Wrangler appends to the file, so an earlier deploy's alias would answer for this one.
  yield* fs.remove(outputFile, { force: true });
  if (!(yield* commandPasses("bunx", deployArgs(deploy), { WRANGLER_OUTPUT_FILE_PATH: outputFile }))) return false;
  const alias = deployedAlias(yield* fs.readFileString(outputFile).pipe(Effect.catchTag("PlatformError", () => Effect.succeed(""))));
  if (alias !== origin) {
    return yield* new AliasMismatch({ message: `Cloudflare serves the branch at '${alias}', not at the ${origin} the build points to` });
  }
  yield* Console.log(`Cloudflare serves ${deploy.branch} at ${origin}`);
  return true;
});
