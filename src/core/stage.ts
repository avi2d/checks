import { Effect, Option, Schema } from "effect";
import type { DeclaredSetting, KitGate } from "./gates.ts";
import { git } from "./git.ts";
import { Inputs, loadSettings } from "./settings.ts";

const STAGES = ["source", "built"] as const;

export type Stage = (typeof STAGES)[number];

export type DeclaredGate = KitGate & { readonly reads: "tree"; readonly appliesTo: DeclaredSetting };

export function isDeclaredGate(gate: KitGate): gate is DeclaredGate {
  return gate.reads === "tree" && typeof gate.appliesTo === "object" && "setting" in gate.appliesTo;
}

// A build writes files git does not track, so a declared input that matches no tracked file reads build output.
export function readsBuildOutput(inputs: readonly string[], tracked: readonly string[]): boolean {
  return inputs.some((input) => {
    const glob = new Bun.Glob(input);
    return !tracked.some((file) => glob.match(file));
  });
}

const decodeInputs = Schema.decodeUnknownOption(Inputs);

export const trackedFiles = Effect.fn("trackedFiles")(function* (root: string) {
  return (yield* git(["ls-files", "-z"], root)).split("\0").filter(Boolean);
});

// A gate whose inputs do not decode stays in the source stage, so it runs before any build and names what is wrong.
export const stageOf = Effect.fn("stageOf")(function* (gate: KitGate, root: string, tracked: readonly string[]) {
  if (!isDeclaredGate(gate)) return "source" satisfies Stage;
  const declared = decodeInputs((yield* loadSettings(root))[gate.appliesTo.setting]);
  if (Option.isNone(declared)) return "source" satisfies Stage;
  return readsBuildOutput(declared.value.inputs, tracked) ? ("built" satisfies Stage) : ("source" satisfies Stage);
});

export function parseStage(args: readonly string[]): { readonly stage: Stage | undefined; readonly rest: readonly string[] } | undefined {
  const at = args.indexOf("--stage");
  if (at === -1) return { stage: undefined, rest: args };
  const stage = STAGES.find((known) => known === args[at + 1]);
  const rest = [...args.slice(0, at), ...args.slice(at + 2)];
  if (stage === undefined || rest.includes("--stage")) return undefined;
  return { stage, rest };
}
