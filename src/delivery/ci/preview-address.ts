import { Console, Effect, Schema } from "effect";
import { branchTargetFromEnv, projectHost } from "./lib/cloudflare.ts";
import { writeOutputs } from "./lib/step-output.ts";

const ACTION = "preview-address";
const ALIAS_LENGTH = 28;

class NoAlias extends Schema.TaggedError<NoAlias>()("NoAlias", {
  message: Schema.String,
}) {}

export function branchAlias(branch: string): string {
  return branch
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[^a-z0-9]/gu, "-")
    .slice(0, ALIAS_LENGTH)
    .replace(/^-+|-+$/g, "");
}

export const main = Effect.gen(function* () {
  const { account, project, branch } = yield* branchTargetFromEnv(ACTION);
  const alias = branchAlias(branch);
  if (alias === "") return yield* new NoAlias({ message: `the branch ${branch} leaves no letter or digit for a Pages alias` });
  const origin = `https://${alias}.${yield* projectHost(account, project)}`;
  yield* writeOutputs({ origin });
  yield* Console.log(`${branch} previews at ${origin}`);
  return true;
});
