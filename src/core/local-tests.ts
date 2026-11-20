import { NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import { Config, Effect, Layer } from "effect";
import { Usage } from "./main.ts";
import { AgentTests, decodeSetting, DEFAULT_AGENT_TESTS, loadSettings, SETTINGS_FILE } from "./settings.ts";
import { AGENT_MARKER, AI_AGENT_MARKER, isAgent } from "./agent-marker.ts";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export const allowsLocalAgentTests = Effect.fn("allowsLocalAgentTests")(function* (root: string) {
  const value = (yield* loadSettings(root))["agentTests"];
  const { allowLocal } = value === undefined ? DEFAULT_AGENT_TESTS : yield* decodeSetting("agentTests", AgentTests, value);
  return allowLocal ?? DEFAULT_AGENT_TESTS.allowLocal;
});

export const refuseLocalTests = Effect.fn("refuseLocalTests")(function* (root: string) {
  const [checksAgent, aiAgent] = yield* Config.all([
    Config.String(AGENT_MARKER).pipe(Config.withDefault("")),
    Config.String(AI_AGENT_MARKER).pipe(Config.withDefault("")),
  ]).pipe(Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (!isAgent(checksAgent, aiAgent)) return;
  const ci = yield* Config.Boolean("CI").pipe(Config.withDefault(false), Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (ci) return;
  if (!(yield* allowsLocalAgentTests(root))) {
    return yield* new Usage({ message: `${SETTINGS_FILE}: agent tests are blocked outside CI; set agentTests.allowLocal to true to allow them` });
  }
});

export function guardLocalTests(root = process.cwd()): Promise<void> {
  return Effect.runPromise(refuseLocalTests(root).pipe(Effect.provide(platform)));
}
