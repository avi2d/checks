import { defineConfig } from "./dist/presets/dependency-cruiser.js";

export default defineConfig({
  // Consumers load each plugin through its dist bundle, and checks-imports hands the kit's defaults to dependency-cruiser by path, so no source file here imports them.
  orphans: ["(^|/)effect-channel/index[.]ts$", "(^|/)readability/index[.]ts$", "(^|/)data-shape/index[.]ts$", "^src/dependencies/kit-defaults[.]ts$"],
  forbidden: [
    {
      name: "host-loaded-imports-nothing",
      severity: "error",
      comment:
        "A host copies src/quality/comment-matchers.ts or src/docs/prose-matchers.ts alone into a directory with no node_modules and loads it, so each imports nothing: not effect, not node:, not another file here. Effect wrappers go in src/quality/comments.ts and src/docs/docs.ts.",
      from: { path: "^src/(?:quality/comment|docs/prose)-matchers[.]ts$" },
      to: {},
    },
  ],
});
