import type { Plugin } from "@oxlint/plugins";
import cognitiveComplexity from "./cognitive-complexity.ts";

const plugin: Plugin = {
  meta: { name: "readability" },
  rules: {
    "cognitive-complexity": cognitiveComplexity,
  },
};

export default plugin;
