import { NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import { Config, Effect, Layer } from "effect";
import { Usage } from "./main.ts";
import { AgentTests, decodeSetting, DEFAULT_AGENT_TESTS, flatSettingPath, loadSettings, SETTINGS_FILE, settingLocation } from "./settings.ts";
import { AGENT_MARKER, AI_AGENT_MARKER, isAgent } from "./agent-marker.ts";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const readAgentPolicy = Effect.fn("readAgentPolicy")(function* (root: string) {
  const settings = yield* loadSettings(root);
  const value = settings.values["agentTests"];
  const { allowLocal } = value === undefined ? DEFAULT_AGENT_TESTS : yield* decodeSetting("agentTests", AgentTests, value, settingLocation(settings.locations, "agentTests"));
  return { allowLocal: allowLocal ?? DEFAULT_AGENT_TESTS.allowLocal, location: settings.locations.agentTests === "agentTests" ? flatSettingPath("agentTests") : settings.locations.agentTests };
});

export const allowsLocalAgentTests = Effect.fn("allowsLocalAgentTests")(function* (root: string) {
  return (yield* readAgentPolicy(root)).allowLocal;
});

export const refuseLocalTests = Effect.fn("refuseLocalTests")(function* (root: string) {
  const [checksAgent, aiAgent] = yield* Config.all([
    Config.String(AGENT_MARKER).pipe(Config.withDefault("")),
    Config.String(AI_AGENT_MARKER).pipe(Config.withDefault("")),
  ]).pipe(Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (!isAgent(checksAgent, aiAgent)) return;
  const ci = yield* Config.Boolean("CI").pipe(Config.withDefault(false), Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (ci) return;
  const policy = yield* readAgentPolicy(root);
  if (!policy.allowLocal) {
    return yield* new Usage({ message: `${SETTINGS_FILE}${policy.location === undefined ? "" : ` key ${policy.location}`}: agent tests are blocked outside CI; set test.allowAgentRunsOutsideCI to true to allow them` });
  }
});

export function guardLocalTests(root = process.cwd()): Promise<void> {
  return Effect.runPromise(refuseLocalTests(root).pipe(Effect.provide(platform)));
}
