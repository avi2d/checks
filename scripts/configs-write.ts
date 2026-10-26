#!/usr/bin/env bun
import { Console, Effect, Path } from "effect";
import { base as oxlintBase } from "../dist/presets/oxlint.js";
import { base as cruiseBase } from "../src/quality/presets/dependency-cruiser.ts";
import { kitCheckout } from "./kit-checkout.ts";
import { runMain } from "../src/core/main.ts";

const OXLINTRC = "oxlintrc.json";
const CRUISE_BASE = "dependency-cruiser.config.js";

const write = Effect.gen(function* () {
  const checkout = yield* kitCheckout;
  const path = yield* Path.Path;
  const root = path.join(import.meta.dir, "..");
  const jsPlugins = (oxlintBase.jsPlugins ?? []).map((plugin) => `./${path.relative(root, typeof plugin === "string" ? plugin : plugin.specifier)}`);
  yield* checkout.write(OXLINTRC, `${JSON.stringify({ ...oxlintBase, jsPlugins }, null, 2)}\n`);
  yield* checkout.write(CRUISE_BASE, `export default ${JSON.stringify(cruiseBase, null, 2)};\n`);
  yield* Console.log(`configs: wrote ${OXLINTRC} and ${CRUISE_BASE}`);
  return true;
});

if (import.meta.main) runMain("configs", write);
