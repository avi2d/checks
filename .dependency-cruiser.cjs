module.exports = {
  extends: "./dependency-cruiser.config.js",
  forbidden: [
    {
      name: "host-loaded-imports-nothing",
      severity: "error",
      comment:
        "A host copies src/quality/comment-matchers.ts or src/docs/prose-matchers.ts alone into a directory with no node_modules and loads it, so each imports nothing: not effect, not node:, not another file here. Effect wrappers go in src/quality/comments.ts and src/docs/docs.ts.",
      from: { path: "^src/(?:quality/comment|docs/prose)-matchers[.]ts$" },
      to: {},
    },
    {
      name: "no-orphans",
      from: {
        orphan: true,
        // Consumers load these entries, each plugin through its dist bundle, so no source file here imports them.
        pathNot: [
          "(^|/)effect-channel/index[.]ts$",
          "(^|/)readability/index[.]ts$",
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
    // The bundles built from effect-channel and readability, which the cruise reads as source.
    // The cruise follows the repos/ links without the second branch.
    exclude: { path: "^(dist|repos)/" },
  },
};
