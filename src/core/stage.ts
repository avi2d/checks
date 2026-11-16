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

export function staticPrefixOf(input: string): string {
  const at = input.search(/[*?[{]/);
  return at === -1 ? input : input.slice(0, at);
}

export function readsBuildOutput(inputs: readonly string[], tracked: readonly string[], isIgnored: (prefix: string) => boolean): boolean {
  let missing = false;
  for (const input of inputs) {
    const glob = new Bun.Glob(input);
    if (tracked.some((file) => glob.match(file))) continue;
    missing = true;
    if (!isIgnored(staticPrefixOf(input))) return false;
  }
  return missing;
}

const isIgnoredPrefix = Effect.fn("isIgnoredPrefix")(function* (prefix: string, root: string) {
  if (prefix === "") return false;
  return yield* git(["check-ignore", "-q", prefix], root).pipe(
    Effect.as(true),
    Effect.catchTag("GitFailure", () => Effect.succeed(false)),
  );
});

const decodeInputs = Schema.decodeUnknownOption(Inputs);

export const trackedFiles = Effect.fn("trackedFiles")(function* (root: string) {
  return (yield* git(["ls-files", "-z"], root)).split("\0").filter(Boolean);
});

// A gate whose inputs do not decode stays in the source stage, so it runs before any build and names what is wrong.
export const stageOf = Effect.fn("stageOf")(function* (gate: KitGate, root: string, tracked: readonly string[]) {
  if (!isDeclaredGate(gate)) return "source" satisfies Stage;
  const declared = decodeInputs((yield* loadSettings(root))[gate.appliesTo.setting]);
  if (Option.isNone(declared)) return "source" satisfies Stage;
  const prefixes = [...new Set(declared.value.inputs.map(staticPrefixOf))];
  const ignored = new Set<string>();
  for (const prefix of prefixes) {
    if (prefix !== "" && (yield* isIgnoredPrefix(prefix, root))) ignored.add(prefix);
  }
  return readsBuildOutput(declared.value.inputs, tracked, (prefix) => ignored.has(prefix)) ? ("built" satisfies Stage) : ("source" satisfies Stage);
});

export function parseStage(args: readonly string[]): { readonly stage: Stage | undefined; readonly rest: readonly string[] } | undefined {
  const at = args.indexOf("--stage");
  if (at === -1) return { stage: undefined, rest: args };
  const stage = STAGES.find((known) => known === args[at + 1]);
  const rest = [...args.slice(0, at), ...args.slice(at + 2)];
  if (stage === undefined || rest.includes("--stage")) return undefined;
  return { stage, rest };
}
