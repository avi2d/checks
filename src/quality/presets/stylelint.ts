import { fileURLToPath } from "node:url";
import valueParser from "postcss-value-parser";
import type { Config, Plugin, RuleBase } from "stylelint";

type Globs = readonly [string, ...string[]];

export type BaselineTarget = "widely" | "newly" | number;

export type ChecksStylelintConfig = Omit<Config, "extends" | "plugins"> & {
  readonly baseline: BaselineTarget;
  readonly tokens: Globs | false;
  readonly bem?: boolean;
  readonly flatSelectors?: boolean;
  readonly noPageHas?: boolean;
};

type Rules = NonNullable<Config["rules"]>;

const HTML_AND_ASTRO = ["**/*.html", "**/*.astro"] as const;

export const MARKUP = [...HTML_AND_ASTRO, "**/*.vue", "**/*.svelte"] as const;

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

// [\s\S] without anchors passes an empty /**/, so the anchors refuse every comment text there is.
const COMMENT_REFUSAL = {
  "comment-word-disallowed-list": ["/^[\\s\\S]*$/"],
} as const satisfies Rules;

// A non-ASCII class refuses every language at once, where naming scripts would chase each one.
const LANGUAGE_FREE_SELECTORS = {
  "selector-disallowed-list": ["/[^\\x00-\\x7F]/"],
} as const satisfies Rules;

const COLOUR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"] as const;

// selector-class-pattern builds a RegExp from the string itself, so slashes would match literal slashes.
const BEM_NAMES = {
  "selector-class-pattern": "^[a-z][a-z0-9]*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$",
} as const satisfies Rules;

const POSITIONAL_PSEUDO_CLASSES = [
  "first-child",
  "last-child",
  "only-child",
  "nth-child",
  "nth-last-child",
  "first-of-type",
  "last-of-type",
  "only-of-type",
  "nth-of-type",
  "nth-last-of-type",
] as const;

const FLAT_SELECTORS = {
  "selector-max-type": 0,
  "selector-max-id": 0,
  "selector-max-universal": 0,
  "selector-max-compound-selectors": 2,
  "max-nesting-depth": 0,
  "selector-max-attribute": 0,
  "selector-pseudo-class-disallowed-list": POSITIONAL_PSEUDO_CLASSES,
} as const satisfies Rules;

// The ban needs both a page element and :has( in one selector, in either order, and a class such as .block-body holds neither.
// The rule tests the raw selector, newlines included, so [\s\S] stands where . would stop at a line break.
const PAGE_HAS = "/^(?=[\\s\\S]*:has\\()(?=[\\s\\S]*(?:(?:^|[\\s>+~,([])(?:html|body|main)|:root)(?![\\w-]))[\\s\\S]*$/i";

const PSEUDO_ARGUMENT = "(?:[^()]|\\([^()]*\\))*";

const PSEUDO_CLASS = `::?[\\w-]+(?:\\(${PSEUDO_ARGUMENT}\\))?`;

const HAS_IN_PSEUDO_CLASS = `(?::has\\(${PSEUDO_ARGUMENT}\\)|::?[\\w-]+\\(${PSEUDO_ARGUMENT}:has\\([^()]*\\)${PSEUDO_ARGUMENT}\\))`;

// A compound of pseudo-classes alone, :scope and :not(.card) among them, can match the root element, so its :has() reads page state.
const CLASSLESS_HAS = `/(?:^|[\\s>+~,])(?:${PSEUDO_CLASS})*${HAS_IN_PSEUDO_CLASS}(?:${PSEUDO_CLASS})*(?=[\\s>+~,]|$)/i`;

const VAR = "var\\(\\s*--[^\\s,()]+\\s*\\)";

const VAR_NAMES = /var\(\s*(--[^\s,()]+)\s*\)/gi;

const FONT_SIZE_VALUE = new RegExp(`^${VAR}$`, "i");

const FONT_STYLE_VARIANT_WEIGHT_OR_WIDTH = "(?:normal|italic|oblique(?:\\s+-?[\\d.]+(?:deg|grad|rad|turn))?|small-caps|bold|bolder|lighter|[1-9]\\d*(?:\\.\\d+)?|(?:ultra-|extra-|semi-)?(?:condensed|expanded))";

const FONT_FAMILY = `(?:"[^"]*"|'[^']*'|${VAR}|-?[a-z_][\\w-]*(?:\\s+-?[a-z_][\\w-]*)*)`;

const FONT_FAMILIES = `${FONT_FAMILY}(?:\\s*,\\s*${FONT_FAMILY})*`;

const FONT_FAMILY_VALUE = new RegExp(`^${FONT_FAMILIES}$`, "i");

const NAMED_FONT_SIZES = new Set([
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
  "larger",
  "smaller",
]);

const FONT_VALUE = new RegExp(
  `^(?:${FONT_STYLE_VARIANT_WEIGHT_OR_WIDTH}\\s+)*(?<size>${VAR})(?:\\s*\\/\\s*(?:${VAR}|[\\w.%-]+))?(?:\\s+(?<families>${FONT_FAMILIES}))?$`,
  "i",
);

const FONT_SIZE_RULE = "checks/font-size-from-tokens";

function varNames(value: string): string[] {
  return [...value.matchAll(VAR_NAMES)].map(([, name]) => name).filter((name) => name !== undefined);
}

type SizeCarrier = { readonly token: string; readonly setTo: RegExp };

// A var() before the size var can be a weight, which leaves a family var() free to hold the size.
function sizeCarriers(property: string, value: string): SizeCarrier[] {
  const name = property.toLowerCase();
  if (name === "font-size" && FONT_SIZE_VALUE.test(value)) return varNames(value).map((token) => ({ token, setTo: FONT_SIZE_VALUE }));
  const font = name === "font" ? FONT_VALUE.exec(value)?.groups : undefined;
  if (font?.size === undefined) return [];
  return [
    ...varNames(font.size).map((token) => ({ token, setTo: FONT_SIZE_VALUE })),
    ...varNames(font.families ?? "").map((token) => ({ token, setTo: FONT_FAMILY_VALUE })),
  ];
}

function namedSize(value: string): string | undefined {
  let found: string | undefined;
  valueParser(value).walk((node) => {
    if (node.type === "word" && NAMED_FONT_SIZES.has(node.value.toLowerCase())) found ??= node.value;
    return undefined;
  });
  return found;
}

function fromTokens({ token, setTo }: SizeCarrier, declared: ReadonlyMap<string, readonly string[]>, seen: ReadonlySet<string>): boolean {
  const values = declared.get(token);
  if (values === undefined) return true;
  return values.every(
    (value) =>
      setTo.test(value) &&
      namedSize(value) === undefined &&
      varNames(value).every((alias) => !seen.has(alias) && fromTokens({ token: alias, setTo }, declared, new Set([...seen, alias]))),
  );
}

const declaredByFile = new WeakMap<object, Map<string, string[]>>();

type DeclarationDocument = {
  walkDecls(filter: RegExp, visit: (decl: { readonly prop: string; readonly value: string }) => void): void;
};

function fileDeclarations(document: DeclarationDocument): Map<string, string[]> {
  const cached = declaredByFile.get(document);
  if (cached !== undefined) return cached;
  const fresh = new Map<string, string[]>();
  document.walkDecls(/^--/, ({ prop, value }) => {
    fresh.set(prop, [...(fresh.get(prop) ?? []), value]);
  });
  declaredByFile.set(document, fresh);
  return fresh;
}

// postcss-html hands the rule one root per style block or attribute, so the file's declarations sit on the result's document.
const fontSizeFromTokens: RuleBase = () => async (root, result) => {
  const { utils } = (await import("stylelint")).default;
  const declared = fileDeclarations(result.root);
  root.walkDecls((node) => {
    const carriers = sizeCarriers(node.prop, node.value);
    const literal = node.prop.toLowerCase() === "font" && carriers.length > 0 ? namedSize(node.value) : undefined;
    if (literal !== undefined) {
      utils.report({ ruleName: FONT_SIZE_RULE, result, node, word: literal, message: `Expected the font size from the token files rather than the literal "${literal}"` });
    }
    for (const carrier of carriers) {
      if (fromTokens(carrier, declared, new Set([carrier.token]))) continue;
      utils.report({ ruleName: FONT_SIZE_RULE, result, node, word: carrier.token, message: `Expected "${carrier.token}" from the token files rather than set in this file` });
    }
  });
};

const FONT_SIZE_PLUGIN = {
  ruleName: FONT_SIZE_RULE,
  rule: Object.assign(fontSizeFromTokens, { ruleName: FONT_SIZE_RULE, messages: {} }),
} satisfies Plugin;

const DESIGN_TOKENS = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": COLOUR_FUNCTIONS.map((name) => `/^${name}$/i`),
  "declaration-property-value-allowed-list": {
    "/^font-size$/i": [String(FONT_SIZE_VALUE), "/^inherit$/i"],
    "/^font$/i": [String(FONT_VALUE), "/^inherit$/i"],
  },
  [FONT_SIZE_RULE]: true,
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

const BASELINE_RULE = "plugin/use-baseline";

// A repository's Baseline entry replaces the kit's option object whole, so the @property pass goes into whichever entry lands.
function passProperty(entry: Rules[string]): unknown {
  if (entry === null || entry === undefined) return entry;
  const [primary, options = {}] = Array.isArray(entry) ? entry : [entry];
  const ignored: unknown = Reflect.get(options, "ignoreAtRules") ?? [];
  if (!Array.isArray(ignored)) return entry;
  return [primary, { ...options, ignoreAtRules: ["property", ...ignored] }];
}

function designTokens(files: readonly string[]): Required<Pick<Config, "rules" | "overrides">> {
  if (files.length === 0) return { rules: {}, overrides: [] };
  const off = Object.fromEntries(Object.keys(DESIGN_TOKENS).map((rule) => [rule, null]));
  return { rules: DESIGN_TOKENS, overrides: [{ files: [...files], rules: off }] };
}

function disallowedSelectors(noPageHas: boolean | undefined): Rules {
  if (noPageHas === true) return { "selector-disallowed-list": [[...LANGUAGE_FREE_SELECTORS["selector-disallowed-list"], PAGE_HAS, CLASSLESS_HAS], { splitList: true }] };
  return LANGUAGE_FREE_SELECTORS;
}

// The types refuse a missing or malformed baseline or tokens, and the guards repeat it for a config no typecheck reads.
export function defineConfig({ baseline, tokens, bem, flatSelectors, noPageHas, rules, overrides = [], ...rest }: ChecksStylelintConfig): Config {
  const available = baselineTarget(baseline);
  const tokenRules = designTokens(tokenFiles(tokens));
  const merged: Rules = {
    ...CONVENTION_CHANGES,
    ...SELECTOR_COMPLEXITY,
    ...COMMENT_REFUSAL,
    ...disallowedSelectors(noPageHas),
    [BASELINE_RULE]: [true, { available }],
    ...tokenRules.rules,
    ...(bem === true ? BEM_NAMES : null),
    ...(flatSelectors === true ? FLAT_SELECTORS : null),
    ...rules,
  };
  return {
    ...rest,
    extends: [peer("stylelint-config-standard")],
    plugins: [peer("stylelint-plugin-use-baseline"), FONT_SIZE_PLUGIN],
    rules: { ...merged, [BASELINE_RULE]: passProperty(merged[BASELINE_RULE]) },
    overrides: [
      { files: [...MARKUP], customSyntax: peer("postcss-html") },
      { files: [...HTML_AND_ASTRO], rules: { "declaration-block-single-line-max-declarations": null } },
      ...tokenRules.overrides,
      ...overrides,
    ],
  };
}
