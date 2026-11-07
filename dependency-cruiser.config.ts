import type { IForbiddenRuleType } from "dependency-cruiser";
import { defineConfig } from "./dist/presets/dependency-cruiser.js";
import type { VECTORS } from "./src/core/gates.ts";

type Area = (typeof VECTORS)[number] | "core";

// No area lists one that reaches back to it, or the two would import each other.
const AREA_IMPORTS = {
  core: [],
  complexity: [],
  quality: [],
  testing: ["dependencies", "quality"],
  docs: [],
  delivery: ["dependencies", "docs", "quality"],
  dependencies: ["quality"],
} as const satisfies Record<Area, readonly Area[]>;

function areaBoundary([area, listed]: readonly [string, readonly Area[]]): IForbiddenRuleType {
  const reached = [...new Set<string>(["core", ...listed])].filter((name) => name !== area);
  const reach = reached.length === 0 ? "no other area" : `only ${reached.map((name) => `src/${name}/`).join(", ")} of the other areas`;
  return {
    name: `${area}-imports-listed-areas`,
    severity: "error",
    comment: `src/${area}/ imports ${reach}. A new edge goes into AREA_IMPORTS in dependency-cruiser.config.ts, or the code both areas need moves into src/core/.`,
    from: { path: `^src/${area}/` },
    to: { path: "^src/", pathNot: `^src/(?:${[area, ...reached].join("|")})/` },
  };
}

export default defineConfig({
  // Consumers load each plugin through its dist bundle, checks-graphwalk hands the kit's defaults to dependency-cruiser by path, and checks-flake hands its preload to bun by path, so no source file here imports them.
  orphans: ["(^|/)effect-channel/index[.]ts$", "(^|/)readability/index[.]ts$", "(^|/)data-shape/index[.]ts$", "^src/testing/mutation-guard-plugin[.]ts$", "^src/dependencies/kit-defaults[.]ts$", "^src/testing/flake-preload[.]ts$"],
  forbidden: [
    {
      name: "host-loaded-imports-nothing",
      severity: "error",
      comment:
        "A host copies src/quality/comment-matchers.ts or src/docs/prose-matchers.ts alone into a directory with no node_modules and loads it, so each imports nothing: not effect, not node:, not another file here. Effect wrappers go in src/quality/comments.ts and src/docs/docs.ts.",
      from: { path: "^src/(?:quality/comment|docs/prose)-matchers[.]ts$" },
      to: {},
    },
    ...Object.entries(AREA_IMPORTS).map(areaBoundary),
  ],
});
