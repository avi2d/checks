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
        "Shipped source cannot rely on a package that is absent in production. Move it to dependencies or peerDependencies, or keep the import in a test or config file.",
      from: {
        pathNot: [
          "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
          "(^|/)[^/]*[.]config[.](?:js|cjs|mjs|ts|cts|mts)$",
        ],
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only", "npm-peer"],
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Nothing installed answers to this specifier. Install the package or fix the path.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-deep-imports",
      severity: "error",
      comment:
        "The specifier reaches past the package name into a subpath its exports map does not publish. Depend on a published entry instead.",
      from: {},
      to: {
        couldNotResolve: true,
        path: "^(@[^/]+/[^/]+|[^@./#][^/]*)/",
      },
    },
  ],
  options: {
    parser: "swc",
    builtInModules: { add: ["bun"] },
    doNotFollow: { path: ["node_modules"] },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
    },
  },
};
