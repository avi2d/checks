import { Effect } from "effect";
import { git, refArgs } from "./git.ts";
import { readQuality } from "./quality-file.ts";

export const rangeGateInputs = Effect.fn("rangeGateInputs")(function* (usage: string) {
  const refs = yield* refArgs(process.argv.slice(2), usage);
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  return { refs, root, ...(yield* readQuality(root)) };
});
