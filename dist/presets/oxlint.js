// src/quality/presets/oxlint.ts
import { fileURLToPath } from "node:url";
var SIZE_RULES = ["max-lines", "max-lines-per-function", "max-statements", "readability/cognitive-complexity", "max-depth"];
var SOURCE_LIMITS = {
  "max-lines": 400,
  "max-lines-per-function": 100,
  "max-statements": 30,
  "readability/cognitive-complexity": 15,
  "max-depth": 4
};
var TEST_LIMITS = {
  "max-lines": 600,
  "max-lines-per-function": "off",
  "max-statements": 50,
  "readability/cognitive-complexity": 15,
  "max-depth": 4
};
var SOURCES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
var TESTS = ["tests/**", "**/*.test.ts", "**/*.test.tsx"];
var PLUGINS = ["typescript", "oxc", "eslint", "import"];
var EFFECT_ONLY_PLUGINS = ["node", "promise", "unicorn"];
var EFFECT_PLUGINS = [...PLUGINS, ...EFFECT_ONLY_PLUGINS];
var JS_PLUGINS = ["dist/effect-channel/index.js", "dist/readability/index.js", "dist/data-shape/index.js"];
var EFFECT_RULES = {
  "node/no-sync": "error",
  "oxc/no-async-await": "error",
  "promise/avoid-new": "error",
  "unicorn/no-process-exit": "error",
  "effect-channel/no-throw": "error",
  "effect-channel/no-try-catch": "error"
};
var LINE_RULES = new Set(["max-lines", "max-lines-per-function"]);
var REFUSED_EFFECT = "@avi2dg/checks/oxlint: set effect to true, false, or { files, excludeFiles } with at least one glob in files";
function packagePath(path) {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}
var BASE = {
  plugins: [...PLUGINS],
  jsPlugins: JS_PLUGINS.map(packagePath),
  categories: { correctness: "error", suspicious: "error" },
  rules: {
    "effect-channel/no-error-channel-escape": "error",
    "typescript/no-explicit-any": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": true }],
    "typescript/no-inferrable-types": "error",
    "typescript/explicit-module-boundary-types": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/prefer-readonly": "error",
    "typescript/no-unnecessary-condition": ["error", { allowConstantLoopConditions: true }],
    "typescript/no-unnecessary-type-parameters": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-deprecated": "error",
    "typescript/consistent-return": "off"
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      rules: { "data-shape/readonly-collection-param": "error" }
    },
    {
      files: ["**/*.ts", "**/*.tsx"],
      excludeFiles: ["tests/**"],
      rules: {
        "data-shape/schema-twin": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/no-unsafe-call": "error"
      }
    },
    {
      files: ["**/*.astro"],
      rules: { "readability/thin-astro": "error", "import/no-unassigned-import": "off" }
    }
  ]
};
var base = BASE;
function sizeSetting(rule, limit) {
  if (limit === "off")
    return "off";
  return LINE_RULES.has(rule) ? ["error", { max: limit, skipBlankLines: false, skipComments: false }] : ["error", { max: limit }];
}
function sizeBudget(files, limits, excludeFiles = []) {
  const rules = Object.fromEntries(SIZE_RULES.map((rule) => [rule, sizeSetting(rule, limits[rule])]));
  return { files: [...files], excludeFiles: [...excludeFiles], rules };
}
function effectRules(files, excludeFiles = []) {
  return { files: [...files], excludeFiles: [...excludeFiles], plugins: [...EFFECT_PLUGINS], rules: { ...EFFECT_RULES } };
}
function isGlobList(value) {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}
function effectOverrides(effect) {
  if (effect === true)
    return [effectRules(SOURCES, TESTS)];
  if (effect === false)
    return [];
  if (typeof effect !== "object" || effect === null)
    throw new TypeError(REFUSED_EFFECT);
  const files = "files" in effect ? effect.files : undefined;
  const excludeFiles = "excludeFiles" in effect ? effect.excludeFiles : [];
  if (!isGlobList(excludeFiles))
    throw new TypeError(REFUSED_EFFECT);
  if (files === undefined)
    return [effectRules(SOURCES, [...TESTS, ...excludeFiles])];
  if (!isGlobList(files) || files.length === 0)
    throw new TypeError(REFUSED_EFFECT);
  return [effectRules(files, excludeFiles)];
}
function withRulePlugins(override) {
  const rules = Object.keys(override.rules ?? {});
  const namesEffectOnlyRule = rules.some((rule) => EFFECT_ONLY_PLUGINS.some((plugin) => rule.startsWith(`${plugin}/`)));
  if (!namesEffectOnlyRule)
    return override;
  return { ...override, plugins: [...new Set([...EFFECT_PLUGINS, ...override.plugins ?? []])] };
}
function defineConfig({ effect, rules, overrides = [], options, ...rest }) {
  return {
    ...BASE,
    ...rest,
    options: { typeAware: true, ...options },
    rules: { ...BASE.rules, ...rules },
    overrides: [
      ...BASE.overrides,
      sizeBudget(SOURCES, SOURCE_LIMITS, TESTS),
      sizeBudget(TESTS, TEST_LIMITS),
      ...effectOverrides(effect),
      ...overrides.map(withRulePlugins)
    ]
  };
}
export {
  SOURCES,
  SOURCE_LIMITS,
  TESTS,
  TEST_LIMITS,
  base,
  defineConfig,
  effectRules,
  sizeBudget
};
