#!/usr/bin/env bun
import { Console, Effect, JsonSchema, Path, Schema } from "effect";
import { Settings } from "../src/core/settings.ts";
import { base as oxlintBase } from "../dist/presets/oxlint.js";
import { base as cruiseBase } from "../src/quality/presets/dependency-cruiser.ts";
import { kitCheckout } from "./kit-checkout.ts";
import { runMain } from "../src/core/main.ts";

const OXLINTRC = "oxlintrc.json";
const CRUISE_BASE = "dependency-cruiser.config.js";
const SETTINGS_SCHEMA = "dist/checks.schema.json";

function settingsJsonSchema(): string {
  const { schema, definitions } = Schema.toJsonSchemaDocument(Settings, { onExcessProperty: "error" });
  const document = { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12, ...schema, $defs: definitions };
  return `${JSON.stringify(document, null, 2)}\n`;
}

const write = Effect.gen(function* () {
  const checkout = yield* kitCheckout;
  const path = yield* Path.Path;
  const root = path.join(import.meta.dir, "..");
  const jsPlugins = (oxlintBase.jsPlugins ?? []).map((plugin) => `./${path.relative(root, typeof plugin === "string" ? plugin : plugin.specifier)}`);
  yield* checkout.write(OXLINTRC, `${JSON.stringify({ ...oxlintBase, jsPlugins }, null, 2)}\n`);
  yield* checkout.write(CRUISE_BASE, `export default ${JSON.stringify(cruiseBase, null, 2)};\n`);
  yield* checkout.write(SETTINGS_SCHEMA, settingsJsonSchema());
  yield* Console.log(`configs: wrote ${OXLINTRC}, ${CRUISE_BASE}, and ${SETTINGS_SCHEMA}`);
  return true;
});

if (import.meta.main) runMain("configs", write);
