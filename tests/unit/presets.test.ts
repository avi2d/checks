import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { OxlintOverride } from "oxlint";
import { base as builtBase } from "../../dist/presets/oxlint.js";
import { DEV_ONLY, base as cruiseBase, defineConfig as defineCruise } from "../../src/quality/presets/dependency-cruiser.ts";
import { DEFAULT_ENTRY, defineConfig as defineKnip } from "../../src/quality/presets/knip.ts";
import {
  base,
  defineConfig,
  effectRules,
  sizeBudget,
  SOURCE_LIMITS,
  SOURCES,
  TEST_LIMITS,
  TESTS,
} from "../../src/quality/presets/oxlint.ts";

const EFFECT_RULE_NAMES = ["node/no-sync", "oxc/no-async-await", "promise/avoid-new", "unicorn/no-process-exit", "effect-channel/no-throw", "effect-channel/no-try-catch"];

function loaded(define: (config: never) => unknown, config: unknown): () => unknown {
  return () => Reflect.apply(define, undefined, [config]);
}

test("effect: true budgets sources and tests over the whole tree and holds every source outside the tests to the Effect rules", () => {
  const config = defineConfig({ effect: true });
  expect(config.plugins).toEqual(base.plugins);
  expect(config.jsPlugins).toEqual(base.jsPlugins);
  expect(config.categories).toEqual(base.categories);
  expect(config.rules).toEqual(base.rules);
  expect(config.options).toEqual({ typeAware: true });
  expect(config.overrides).toEqual([
    ...(base.overrides ?? []),
    sizeBudget(SOURCES, SOURCE_LIMITS, TESTS),
    sizeBudget(TESTS, TEST_LIMITS),
    effectRules(SOURCES, TESTS),
  ]);
});

test("the size budget writes each limit as the rule's own option and turns off a limit set to off", () => {
  expect(sizeBudget(TESTS, TEST_LIMITS)).toEqual({
    files: [...TESTS],
    excludeFiles: [],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": "off",
      "max-statements": ["error", { max: 50 }],
      "readability/cognitive-complexity": ["error", { max: 15 }],
      "max-depth": ["error", { max: 4 }],
    },
  });
});

test("the Effect override carries the six Effect rules and restates the root plugins beside node, promise and unicorn", () => {
  const override = effectRules(["src/**/*.ts"], ["src/host/**"]);
  expect(Object.keys(override.rules ?? {})).toEqual(EFFECT_RULE_NAMES);
  expect(override.plugins).toEqual([...(base.plugins ?? []), "node", "promise", "unicorn"]);
  expect({ files: override.files, excludeFiles: override.excludeFiles }).toEqual({ files: ["src/**/*.ts"], excludeFiles: ["src/host/**"] });
});

test("effect: false leaves the Effect rules out and keeps both budgets", () => {
  expect(defineConfig({ effect: false }).overrides?.slice(-2)).toEqual([sizeBudget(SOURCES, SOURCE_LIMITS, TESTS), sizeBudget(TESTS, TEST_LIMITS)]);
});

test("effect excludeFiles alone narrows every source outside the tests, and files with excludeFiles name the paths exactly", () => {
  expect(defineConfig({ effect: { excludeFiles: ["home/**"] } }).overrides?.at(-1)).toEqual(effectRules(SOURCES, [...TESTS, "home/**"]));
  expect(defineConfig({ effect: { files: ["src/**/*.ts"], excludeFiles: ["src/host/**"] } }).overrides?.at(-1)).toEqual(
    effectRules(["src/**/*.ts"], ["src/host/**"]),
  );
});

test("the project's own keys land after the kit's: its rules over the base rules, its overrides last, its options beside typeAware", () => {
  const own: OxlintOverride = { files: ["src/law-table.ts"], rules: { "max-lines": ["error", { max: 900 }] } };
  const config = defineConfig({
    effect: true,
    ignorePatterns: ["dist/**"],
    rules: { "typescript/consistent-return": "error" },
    overrides: [own],
    options: { typeCheck: true },
  });
  expect(config.ignorePatterns).toEqual(["dist/**"]);
  expect(config.rules?.["typescript/consistent-return"]).toBe("error");
  expect(config.rules?.["typescript/no-explicit-any"]).toBe("error");
  expect(config.overrides?.at(-1)).toEqual(own);
  expect(config.options).toEqual({ typeAware: true, typeCheck: true });
});

test("the oxlint builder refuses a config with no effect, a string effect, empty files or excludeFiles that is not a list", () => {
  const refusal = "@avi2dg/checks/oxlint: set effect to true, false, or { files, excludeFiles } with at least one glob in files";
  for (const config of [{ ignorePatterns: ["dist/**"] }, { effect: "src/**/*.ts" }, { effect: { files: [] } }, { effect: { excludeFiles: "home/**" } }, { effect: null }]) {
    expect(loaded(defineConfig, config)).toThrow(refusal);
  }
});

test("the knip builder adds the kit's include and default entries to the project's own, once each", () => {
  expect(defineKnip({ entry: ["src/index.ts", "tests/**/*.test.ts"], ignore: ["generated/**"] })).toEqual({
    include: ["files"],
    ignore: ["generated/**"],
    entry: ["src/index.ts", ...DEFAULT_ENTRY],
  });
  expect(defineKnip({ entry: [] }).entry).toEqual([...DEFAULT_ENTRY]);
});

test("the knip builder refuses a config with no entry or a string entry", () => {
  const refusal = "@avi2dg/checks/knip: set entry to the files nothing imports, or [] when package.json scripts and tests name them all";
  for (const config of [{ ignore: ["generated/**"] }, { entry: "src/index.ts" }]) expect(loaded(defineKnip, config)).toThrow(refusal);
});

function ruleNamed(config: ReturnType<typeof defineCruise>, name: string): unknown {
  return config.forbidden?.find((rule) => rule.name === name);
}

test("the dependency-cruiser builder carries the kit's six rules and options, with tests/ allowed dev dependencies", () => {
  const config = defineCruise();
  expect(config.forbidden?.map(({ name }) => name)).toEqual(cruiseBase.forbidden?.map(({ name }) => name));
  expect(ruleNamed(config, "not-to-dev-dep")).toMatchObject({ from: { pathNot: expect.arrayContaining([...DEV_ONLY]) } });
  expect(config.options).toEqual({ ...cruiseBase.options, exclude: { path: ["^repos/"] } });
});

test("devOnly replaces the dev-only paths, orphans widen no-orphans, and exclude joins the kit's", () => {
  const config = defineCruise({ devOnly: ["^(?:evals|tests)/"], orphans: ["(^|/)bin[.]ts$"], options: { exclude: { path: ["^[.]astro/", "^dist/"] } } });
  const devOnly = ruleNamed(config, "not-to-dev-dep");
  expect(devOnly).toMatchObject({ from: { pathNot: expect.arrayContaining(["^(?:evals|tests)/"]) } });
  expect(devOnly).not.toMatchObject({ from: { pathNot: expect.arrayContaining([...DEV_ONLY]) } });
  expect(ruleNamed(config, "no-orphans")).toMatchObject({ from: { pathNot: expect.arrayContaining(["(^|/)bin[.]ts$"]) } });
  expect(config.options?.exclude).toEqual({ path: ["^repos/", "^[.]astro/", "^dist/"] });
});

test("a project rule named for a kit rule replaces it, and any other is added after the kit's", () => {
  const replaced = { name: "no-circular", severity: "warn", from: {}, to: { circular: true } } as const;
  const added = { name: "rules-stay-pure", severity: "error", from: { path: "^src/rules" }, to: { path: "^src/io" } } as const;
  const config = defineCruise({ forbidden: [replaced, added] });
  expect(config.forbidden?.filter(({ name }) => name === "no-circular")).toEqual([replaced]);
  expect(config.forbidden?.slice(-2)).toEqual([replaced, added]);
  expect(config.forbidden).toHaveLength(7);
});

const CHECKOUT = resolve(import.meta.dir, "..", "..");

test("the built base names each plugin bundle by an absolute path that exists, and oxlintrc.json is that base with the paths relative", () => {
  const bundles = (builtBase.jsPlugins ?? []).map((plugin) => (typeof plugin === "string" ? plugin : plugin.specifier));
  expect(bundles.filter((bundle) => !bundle.startsWith(`${CHECKOUT}/dist/`) || !Bun.file(bundle).size)).toEqual([]);
  const shipped: unknown = JSON.parse(readFileSync(resolve(CHECKOUT, "oxlintrc.json"), "utf8"));
  expect(shipped).toEqual({ ...builtBase, jsPlugins: bundles.map((bundle) => `./${relative(CHECKOUT, bundle)}`) });
});
