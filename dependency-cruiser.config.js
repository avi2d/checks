/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A circular relationship never has a single entry point, so invert one side.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "Nothing reaches this module. Use it, remove it, or exempt the entry point by name in your own config.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.]ts$",
          "(^|/)tsconfig[.]json$",
          "(^|/)(?:babel|webpack)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "(^|/)[^/]*[.]config[.](?:js|cjs|mjs|ts|cts|mts)$",
          "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
        ],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Shipped source cannot rely on a package that is absent in production. Move it to dependencies, or keep the import in a test or config file.",
      from: {
        pathNot: [
          "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
          "(^|/)[^/]*[.]config[.](?:js|cjs|mjs|ts|cts|mts)$",
        ],
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-deep-imports",
      severity: "error",
      comment:
        "A subpath reaches past the package entry into its internals. Depend on the entry point instead.",
      from: {},
      // Bare entries resolve inside the package folder too, so the second
      // segment keeps them allowed while subpaths stay forbidden. Entries
      // live in index files, so those stay allowed as well.
      to: {
        path: "(^|/)node_modules/(@[^/]+/[^/]+|[^@/][^/]*)/[^/]+/.+",
        pathNot: "/index[.][^/]+$",
      },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
  },
};
