import { defineConfig } from "./dist/presets/knip.js";

export default defineConfig({
  entry: [
    "src/quality/effect-channel/index.ts",
    "src/complexity/readability/index.ts",
    "src/quality/data-shape/index.ts",
    "src/testing/bun-test/index.ts",
    "src/quality/presets/*.ts",
    "src/testing/mutation-guard-plugin.ts",
    "dist/mutation/mutation-refusal.js",
    "src/dependencies/kit-defaults.ts",
    "src/testing/flake-preload.ts",
    "scripts/native-meta.ts",
    "src/quality/nested-oxlint.ts",
    // scripts/build.ts and scripts/prepare.ts spawn these by path, which knip does not follow.
    "scripts/configs-write.ts",
    "scripts/doc-templates-write.ts",
    "scripts/doc-blocks-write.ts",
    "scripts/launchers-write.ts",
    "scripts/self-bins.ts",
  ],
});
