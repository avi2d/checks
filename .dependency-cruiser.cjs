const { featureRules } = require("./dist/feature-rules.js");

module.exports = {
  extends: "./dependency-cruiser.config.js",
  forbidden: [
    ...featureRules(require("./quality.json")),
    {
      name: "host-loaded-imports-nothing",
      severity: "error",
      comment:
        "A host copies scripts/comment-matchers.ts alone into a directory with no node_modules and loads it, so it imports nothing: not effect, not node:, not another file here. Effect wrappers go in scripts/comments.ts.",
      from: { path: "^scripts/comment-matchers[.]ts$" },
      to: {},
    },
    {
      name: "no-orphans",
      from: {
        orphan: true,
        // Consumers load these entries, the plugin through its dist bundle, so no source file here imports them.
        pathNot: [
          "(^|/)effect-channel/index[.]ts$",
          "(^|/)stryker[.]preset[.]js$",
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.]ts$",
          "(^|/)tsconfig[.]json$",
          "(^|/)(?:babel|webpack)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "(^|/)[^/]*[.]config[.](?:js|cjs|mjs|ts|cts|mts)$",
          "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
        ],
      },
    },
  ],
  options: {
    // The bundle built from effect-channel, which the cruise reads as source.
    exclude: { path: "^dist/" },
  },
};
