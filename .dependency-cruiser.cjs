module.exports = {
  extends: "./dependency-cruiser.config.js",
  forbidden: [
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
