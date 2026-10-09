// src/quality/presets/dependency-cruiser.ts
import { existsSync, readFileSync } from "node:fs";
var DEV_ONLY = ["^tests/"];
var TEST_FILES = "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$";
var MANIFEST = "package.json";
var CONFIG_FILES = "(^|/)[^/]*[.]config[.](?:js|cjs|mjs|ts|cts|mts)$";
var BASE = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A circular relationship never has a single entry point, so invert one side.",
      from: {},
      to: { circular: true }
    },
    {
      name: "no-orphans",
      severity: "error",
      comment: "Nothing reaches this module. Use it, remove it, or exempt the entry point by name in your own config.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.]ts$",
          "(^|/)tsconfig[.]json$",
          "(^|/)(?:babel|webpack)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          CONFIG_FILES,
          TEST_FILES
        ]
      },
      to: {}
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Shipped source cannot rely on a package that is absent in production. Move it to dependencies or peerDependencies, or keep the import in a test or config file.",
      from: { pathNot: [TEST_FILES, CONFIG_FILES] },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only", "npm-peer"] }
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment: "The import resolves to an installed package the nearest package.json does not declare, so it holds only while something else keeps it hoisted. Declare it in dependencies, devDependencies or peerDependencies.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"], dependencyTypesNot: ["npm", "npm-dev", "npm-optional", "npm-peer"] }
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Nothing installed answers to this specifier. Install the package or fix the path.",
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: "no-deep-imports",
      severity: "error",
      comment: "The specifier reaches past the package name into a subpath its exports map does not publish. Depend on a published entry instead.",
      from: {},
      to: { couldNotResolve: true, path: "^(@[^/]+/[^/]+|[^@./#][^/]*)/" }
    }
  ],
  options: {
    parser: "swc",
    builtInModules: { add: ["bun"] },
    doNotFollow: { path: ["node_modules"] },
    exclude: { path: "^repos/" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"]
    }
  }
};
var base = BASE;
function asList(value) {
  if (value === undefined)
    return [];
  return typeof value === "string" ? [value] : value;
}
function widened(rule, extra) {
  if (extra.length === 0 || !("pathNot" in rule.from))
    return rule;
  return { ...rule, from: { ...rule.from, pathNot: [...asList(rule.from.pathNot), ...extra] } };
}
function kitRule(rule, devOnly, orphans) {
  if (rule.name === "not-to-dev-dep")
    return widened(rule, devOnly);
  if (rule.name === "no-orphans")
    return widened(rule, orphans);
  return rule;
}
function excludeObject(exclude) {
  if (exclude === undefined || typeof exclude === "string" || Array.isArray(exclude))
    return { path: [...asList(exclude)] };
  return exclude;
}
function joinedExclude(exclude) {
  const own = excludeObject(exclude);
  return { ...own, path: [...asList(BASE.options.exclude.path), ...asList(own.path)] };
}
function declaresAstro(manifest) {
  if (typeof manifest !== "object" || manifest === null)
    return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const declared = Reflect.get(manifest, field);
    return typeof declared === "object" && declared !== null && "astro" in declared;
  });
}
function dependsOnAstro() {
  return existsSync(MANIFEST) && declaresAstro(JSON.parse(readFileSync(MANIFEST, "utf8")));
}
function defineConfig({ devOnly = DEV_ONLY, orphans = [], forbidden = [], options, ...rest } = {}) {
  const named = new Set(forbidden.map(({ name }) => name));
  if (dependsOnAstro())
    named.add("no-orphans");
  const kitRules = BASE.forbidden.filter(({ name }) => !named.has(name)).map((rule) => kitRule(rule, devOnly, orphans));
  return {
    ...rest,
    forbidden: [...kitRules, ...forbidden],
    options: { ...BASE.options, ...options, exclude: joinedExclude(options?.exclude) }
  };
}
export {
  DEV_ONLY,
  base,
  defineConfig
};
