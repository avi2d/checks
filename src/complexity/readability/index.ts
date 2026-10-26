import type { Plugin } from "@oxlint/plugins";
import cognitiveComplexity from "./cognitive-complexity.ts";
import thinAstro from "./thin-astro.ts";

const plugin: Plugin = {
  meta: { name: "readability" },
  rules: {
    "cognitive-complexity": cognitiveComplexity,
    "thin-astro": thinAstro,
  },
};

export default plugin;
