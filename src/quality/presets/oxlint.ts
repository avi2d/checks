import { fileURLToPath } from "node:url";
import type { OxlintConfig, OxlintOverride } from "oxlint";

type Globs = readonly [string, ...string[]];

export type EffectScope = boolean | { readonly files?: Globs; readonly excludeFiles?: readonly string[] };

export type ChecksConfig = Omit<OxlintConfig, "extends" | "plugins" | "jsPlugins" | "categories"> & {
  readonly effect: EffectScope;
};

const SIZE_RULES = ["max-lines", "max-lines-per-function", "max-statements", "readability/cognitive-complexity", "max-depth"] as const;

export type SizeRule = (typeof SIZE_RULES)[number];

export type SizeLimits = Readonly<Record<SizeRule, number | "off">>;

export const SOURCE_LIMITS = {
  "max-lines": 400,
  "max-lines-per-function": 100,
  "max-statements": 30,
  "readability/cognitive-complexity": 15,
  "max-depth": 4,
} as const satisfies SizeLimits;

export const TEST_LIMITS = {
  "max-lines": 600,
  "max-lines-per-function": "off",
  "max-statements": 50,
  "readability/cognitive-complexity": 15,
  "max-depth": 4,
} as const satisfies SizeLimits;

export const SOURCES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"] as const;

export const TESTS = ["tests/**", "**/*.test.ts", "**/*.test.tsx"] as const;

const PLUGINS = ["typescript", "oxc", "eslint", "import"] as const;

const EFFECT_ONLY_PLUGINS = ["node", "promise", "unicorn"] as const;

const EFFECT_PLUGINS = [...PLUGINS, ...EFFECT_ONLY_PLUGINS] as const;

const JS_PLUGINS = ["dist/effect-channel/index.js", "dist/readability/index.js", "dist/data-shape/index.js"] as const;

const EFFECT_RULES = {
  "node/no-sync": "error",
  "oxc/no-async-await": "error",
  "promise/avoid-new": "error",
  "unicorn/no-process-exit": "error",
  "effect-channel/no-throw": "error",
  "effect-channel/no-try-catch": "error",
} as const;

const LINE_RULES: ReadonlySet<SizeRule> = new Set(["max-lines", "max-lines-per-function"]);

const REFUSED_EFFECT = "@avi2dg/checks/oxlint: set effect to true, false, or { files, excludeFiles } with at least one glob in files";

// oxlint reads each relative jsPlugins path against the consumer's config, not against this package.
function packagePath(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}

const BASE = {
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
    "typescript/consistent-return": "off",
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      rules: { "data-shape/readonly-collection-param": "error" },
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
        "typescript/no-unsafe-call": "error",
      },
    },
    {
      files: ["**/*.astro"],
      rules: { "readability/thin-astro": "error", "import/no-unassigned-import": "off" },
    },
  ],
} satisfies OxlintConfig;

export const base: OxlintConfig = BASE;

function sizeSetting(rule: SizeRule, limit: number | "off"): NonNullable<OxlintConfig["rules"]>[string] {
  if (limit === "off") return "off";
  return LINE_RULES.has(rule) ? ["error", { max: limit, skipBlankLines: false, skipComments: false }] : ["error", { max: limit }];
}

export function sizeBudget(files: readonly string[], limits: SizeLimits, excludeFiles: readonly string[] = []): OxlintOverride {
  const rules = Object.fromEntries(SIZE_RULES.map((rule) => [rule, sizeSetting(rule, limits[rule])]));
  return { files: [...files], excludeFiles: [...excludeFiles], rules };
}

export function effectRules(files: readonly string[], excludeFiles: readonly string[] = []): OxlintOverride {
  return { files: [...files], excludeFiles: [...excludeFiles], plugins: [...EFFECT_PLUGINS], rules: { ...EFFECT_RULES } };
}

function isGlobList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}

// The types already refuse each case below, and the guard repeats them for a config no typecheck reads.
function effectOverrides(effect: unknown): readonly OxlintOverride[] {
  if (effect === true) return [effectRules(SOURCES, TESTS)];
  if (effect === false) return [];
  if (typeof effect !== "object" || effect === null) throw new TypeError(REFUSED_EFFECT);
  const files = "files" in effect ? effect.files : undefined;
  const excludeFiles = "excludeFiles" in effect ? effect.excludeFiles : [];
  if (!isGlobList(excludeFiles)) throw new TypeError(REFUSED_EFFECT);
  if (files === undefined) return [effectRules(SOURCES, [...TESTS, ...excludeFiles])];
  if (!isGlobList(files) || files.length === 0) throw new TypeError(REFUSED_EFFECT);
  return [effectRules(files, excludeFiles)];
}

// oxlint drops an override's setting for a rule whose plugin is neither top-level nor named in that override.
function withRulePlugins(override: OxlintOverride): OxlintOverride {
  const rules = Object.keys(override.rules ?? {});
  const needed = EFFECT_ONLY_PLUGINS.filter((plugin) => rules.some((rule) => rule.startsWith(`${plugin}/`)));
  if (needed.length === 0) return override;
  return { ...override, plugins: [...new Set([...(override.plugins ?? []), ...needed])] };
}

export function defineConfig({ effect, rules, overrides = [], options, ...rest }: ChecksConfig): OxlintConfig {
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
      ...overrides.map(withRulePlugins),
    ],
  };
}
