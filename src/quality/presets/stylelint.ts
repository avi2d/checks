import { fileURLToPath } from "node:url";
import type { Config } from "stylelint";

type Globs = readonly [string, ...string[]];

export type BaselineTarget = "widely" | "newly" | number;

export type ChecksStylelintConfig = Omit<Config, "extends" | "plugins"> & {
  readonly baseline: BaselineTarget;
  readonly tokens: Globs | false;
};

type Rules = NonNullable<Config["rules"]>;

export const MARKUP = ["**/*.html", "**/*.astro", "**/*.vue", "**/*.svelte"] as const;

const SCOPED_STYLE_PSEUDO_CLASSES = ["global", "deep", "slotted"] as const;

// stylelint resolves a name from the repository, and the kit's peers sit beside the kit rather than under every repository it lints.
function peer(name: string): string {
  return fileURLToPath(import.meta.resolve(name));
}

const CONVENTION_CHANGES = {
  "no-descending-specificity": null,
  "property-no-vendor-prefix": [true, { disableFix: true, ignoreProperties: ["-webkit-user-select"] }],
} as const satisfies Rules;

const SELECTOR_COMPLEXITY = {
  "selector-max-specificity": "0,3,2",
  "selector-max-compound-selectors": 3,
} as const satisfies Rules;

const COLOUR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"] as const;

const DESIGN_TOKENS = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": [...COLOUR_FUNCTIONS],
  "declaration-property-value-allowed-list": { "font-size": ["/var\\(--/", "inherit"] },
} as const satisfies Rules;

const REFUSED_BASELINE = '@avi2dg/checks/stylelint: set baseline to "widely", "newly" or a year such as 2024';

const REFUSED_TOKENS = "@avi2dg/checks/stylelint: set tokens to the globs of the token files, or false to leave the design token rules off";

function baselineTarget(baseline: unknown): BaselineTarget {
  if (baseline === "widely" || baseline === "newly") return baseline;
  if (typeof baseline === "number" && Number.isInteger(baseline)) return baseline;
  throw new TypeError(REFUSED_BASELINE);
}

function isGlobList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}

function tokenFiles(tokens: unknown): readonly string[] {
  if (tokens === false) return [];
  if (isGlobList(tokens) && tokens.length > 0) return tokens;
  throw new TypeError(REFUSED_TOKENS);
}

function designTokens(files: readonly string[]): Required<Pick<Config, "rules" | "overrides">> {
  if (files.length === 0) return { rules: {}, overrides: [] };
  const off = Object.fromEntries(Object.keys(DESIGN_TOKENS).map((rule) => [rule, null]));
  return { rules: DESIGN_TOKENS, overrides: [{ files: [...files], rules: off }] };
}

// The types refuse a missing or malformed baseline or tokens, and the guards repeat it for a config no typecheck reads.
export function defineConfig({ baseline, tokens, rules, overrides = [], ...rest }: ChecksStylelintConfig): Config {
  const available = baselineTarget(baseline);
  const tokenRules = designTokens(tokenFiles(tokens));
  return {
    ...rest,
    extends: [peer("stylelint-config-standard")],
    plugins: [peer("stylelint-plugin-use-baseline")],
    rules: {
      ...CONVENTION_CHANGES,
      ...SELECTOR_COMPLEXITY,
      "plugin/use-baseline": [true, { available }],
      ...tokenRules.rules,
      ...rules,
    },
    overrides: [
      {
        files: [...MARKUP],
        customSyntax: peer("postcss-html"),
        rules: {
          "declaration-block-single-line-max-declarations": null,
          "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: [...SCOPED_STYLE_PSEUDO_CLASSES] }],
        },
      },
      ...tokenRules.overrides,
      ...overrides,
    ],
  };
}
