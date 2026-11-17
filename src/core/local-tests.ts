import { NodeFileSystem, NodePath } from "@effect/platform-node-shared";
import { Config, Effect, Layer } from "effect";
import { Usage } from "./main.ts";
import { decodeSetting, loadSettings, LocalTests, SETTINGS_FILE } from "./settings.ts";
import { AGENT_MARKER } from "./agent-marker.ts";

export { AGENT_MARKER };
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export const localTestsSetting = Effect.fn("localTestsSetting")(function* (root: string) {
  const value = (yield* loadSettings(root))["localTests"];
  return value === undefined ? "blocked" : yield* decodeSetting("localTests", LocalTests, value);
});

export const refuseLocalTests = Effect.fn("refuseLocalTests")(function* (root: string) {
  const agent = yield* Config.String(AGENT_MARKER).pipe(Config.withDefault(""), Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (agent !== "1") return;
  const ci = yield* Config.Boolean("CI").pipe(Config.withDefault(false), Effect.mapError((cause) => new Usage({ message: cause.message })));
  if (ci) return;
  if ((yield* localTestsSetting(root)) === "blocked") {
    return yield* new Usage({ message: `${SETTINGS_FILE} localTests is blocked for agents outside CI` });
  }
});

export function guardLocalTests(root = process.cwd()): Promise<void> {
  return Effect.runPromise(refuseLocalTests(root).pipe(Effect.provide(platform)));
}
