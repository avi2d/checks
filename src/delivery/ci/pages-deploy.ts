import { Effect, Schema } from "effect";
import { accountFromEnv, readProjectHost } from "./lib/cloudflare.ts";
import { optionalInput } from "./lib/inputs.ts";
import { commandPasses } from "./lib/run.ts";
import { deployArgs, deployFromEnv } from "./lib/wrangler.ts";

const ACTION = "pages-deploy";

class HostMismatch extends Schema.TaggedError<HostMismatch>()("HostMismatch", {
  message: Schema.String,
}) {}

export const main = Effect.gen(function* () {
  const account = yield* accountFromEnv(ACTION);
  const deploy = yield* deployFromEnv(ACTION);
  const address = yield* optionalInput("ADDRESS");
  if (address !== "") {
    const served = `https://${yield* readProjectHost(account, deploy.project)}/`;
    if (served !== address) {
      return yield* new HostMismatch({ message: `Cloudflare serves ${deploy.project} at ${served}, not at the ${address} the build points to` });
    }
  }
  return yield* commandPasses("bunx", deployArgs(deploy));
});
