import { defineConfig } from "./dist/presets/knip.js";

export default defineConfig({
  entry: [
    "src/quality/effect-channel/index.ts",
    "src/complexity/readability/index.ts",
    "src/quality/data-shape/index.ts",
    "src/quality/presets/*.ts",
    "src/testing/mutation-guard-plugin.ts",
    "dist/mutation/mutation-refusal.js",
    "src/dependencies/kit-defaults.ts",
    "src/testing/flake-preload.ts",
  ],
});
