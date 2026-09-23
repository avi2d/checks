module.exports = {
  extends: "./dependency-cruiser.config.js",
  forbidden: [
    {
      name: "no-orphans",
      from: {
        orphan: true,
        // The plugin entry loads from dist through oxlint, so no source file imports it.
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
};
