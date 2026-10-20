// src/quality/presets/stylelint.ts
import { fileURLToPath } from "node:url";
var HTML_AND_ASTRO = ["**/*.html", "**/*.astro"];
var MARKUP = [...HTML_AND_ASTRO, "**/*.vue", "**/*.svelte"];
function peer(name) {
  return fileURLToPath(import.meta.resolve(name));
}
var CONVENTION_CHANGES = {
  "no-descending-specificity": null,
  "property-no-vendor-prefix": [true, { disableFix: true, ignoreProperties: ["-webkit-user-select"] }]
};
var SELECTOR_COMPLEXITY = {
  "selector-max-specificity": "0,3,2",
  "selector-max-compound-selectors": 3
};
var COMMENT_REFUSAL = {
  "comment-word-disallowed-list": ["/^[\\s\\S]*$/"]
};
var LANGUAGE_FREE_SELECTORS = {
  "selector-disallowed-list": ["/[^\\x00-\\x7F]/"]
};
var COLOUR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"];
var BEM_NAMES = {
  "selector-class-pattern": "^[a-z][a-z0-9]*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$"
};
var POSITIONAL_PSEUDO_CLASSES = [
  "first-child",
  "last-child",
  "only-child",
  "nth-child",
  "nth-last-child",
  "first-of-type",
  "last-of-type",
  "only-of-type",
  "nth-of-type",
  "nth-last-of-type"
];
var FLAT_SELECTORS = {
  "selector-max-type": 0,
  "selector-max-id": 0,
  "selector-max-universal": 0,
  "selector-max-compound-selectors": 2,
  "max-nesting-depth": 0,
  "selector-max-attribute": 0,
  "selector-pseudo-class-disallowed-list": POSITIONAL_PSEUDO_CLASSES
};
var PAGE_HAS = "/^(?=[\\s\\S]*:has\\()(?=[\\s\\S]*(?:(?:^|[\\s>+~,([])(?:html|body|main)|:root)(?![\\w-]))[\\s\\S]*$/i";
var PSEUDO_ARGUMENT = "(?:[^()]|\\([^()]*\\))*";
var PSEUDO_CLASS = `::?[\\w-]+(?:\\(${PSEUDO_ARGUMENT}\\))?`;
var HAS_IN_PSEUDO_CLASS = `(?::has\\(${PSEUDO_ARGUMENT}\\)|::?[\\w-]+\\(${PSEUDO_ARGUMENT}:has\\([^()]*\\)${PSEUDO_ARGUMENT}\\))`;
var CLASSLESS_HAS = `/(?:^|[\\s>+~,])(?:${PSEUDO_CLASS})*${HAS_IN_PSEUDO_CLASS}(?:${PSEUDO_CLASS})*(?=[\\s>+~,]|$)/i`;
var VAR = "var\\(\\s*--[^\\s,()]+\\s*\\)";
var VAR_NAMES = /var\(\s*(--[^\s,()]+)\s*\)/gi;
var FONT_SIZE_VALUE = new RegExp(`^${VAR}$`, "i");
var FONT_STYLE_VARIANT_WEIGHT_OR_WIDTH = "(?:normal|italic|oblique(?:\\s+-?[\\d.]+(?:deg|grad|rad|turn))?|small-caps|bold|bolder|lighter|[1-9]\\d*(?:\\.\\d+)?|(?:ultra-|extra-|semi-)?(?:condensed|expanded))";
var FONT_FAMILY = `(?:"[^"]*"|'[^']*'|${VAR}|-?[a-z_][\\w-]*(?:\\s+-?[a-z_][\\w-]*)*)`;
var FONT_FAMILIES = `${FONT_FAMILY}(?:\\s*,\\s*${FONT_FAMILY})*`;
var FONT_FAMILY_VALUE = new RegExp(`^${FONT_FAMILIES}$`, "i");
var FONT_VALUE = new RegExp(`^(?:${FONT_STYLE_VARIANT_WEIGHT_OR_WIDTH}\\s+)*(?<size>${VAR})(?:\\s*\\/\\s*(?:${VAR}|[\\w.%-]+))?(?:\\s+(?<families>${FONT_FAMILIES}))?$`, "i");
var FONT_SIZE_RULE = "checks/font-size-from-tokens";
function varNames(value) {
  return [...value.matchAll(VAR_NAMES)].map(([, name]) => name).filter((name) => name !== undefined);
}
function sizeCarriers(property, value) {
  const name = property.toLowerCase();
  if (name === "font-size" && FONT_SIZE_VALUE.test(value))
    return varNames(value).map((token) => ({ token, setTo: FONT_SIZE_VALUE }));
  const font = name === "font" ? FONT_VALUE.exec(value)?.groups : undefined;
  if (font?.size === undefined)
    return [];
  return [
    ...varNames(font.size).map((token) => ({ token, setTo: FONT_SIZE_VALUE })),
    ...varNames(font.families ?? "").map((token) => ({ token, setTo: FONT_FAMILY_VALUE }))
  ];
}
function fromTokens({ token, setTo }, declared, seen) {
  const values = declared.get(token);
  if (values === undefined)
    return true;
  return values.every((value) => setTo.test(value) && varNames(value).every((alias) => !seen.has(alias) && fromTokens({ token: alias, setTo }, declared, new Set([...seen, alias]))));
}
var fontSizeFromTokens = () => async (root, result) => {
  const { utils } = (await import("stylelint")).default;
  const declared = new Map;
  result.root.walkDecls(/^--/, ({ prop, value }) => {
    declared.set(prop, [...declared.get(prop) ?? [], value]);
  });
  root.walkDecls((node) => {
    for (const carrier of sizeCarriers(node.prop, node.value)) {
      if (fromTokens(carrier, declared, new Set([carrier.token])))
        continue;
      utils.report({ ruleName: FONT_SIZE_RULE, result, node, word: carrier.token, message: `Expected "${carrier.token}" from the token files rather than set in this file` });
    }
  });
};
var FONT_SIZE_PLUGIN = {
  ruleName: FONT_SIZE_RULE,
  rule: Object.assign(fontSizeFromTokens, { ruleName: FONT_SIZE_RULE, messages: {} })
};
var DESIGN_TOKENS = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": COLOUR_FUNCTIONS.map((name) => `/^${name}$/i`),
  "declaration-property-value-allowed-list": {
    "/^font-size$/i": [String(FONT_SIZE_VALUE), "/^inherit$/i"],
    "/^font$/i": [String(FONT_VALUE), "/^inherit$/i"]
  },
  [FONT_SIZE_RULE]: true
};
var REFUSED_BASELINE = '@avi2dg/checks/stylelint: set baseline to "widely", "newly" or a year such as 2024';
var REFUSED_TOKENS = "@avi2dg/checks/stylelint: set tokens to the globs of the token files, or false to leave the design token rules off";
function baselineTarget(baseline) {
  if (baseline === "widely" || baseline === "newly")
    return baseline;
  if (typeof baseline === "number" && Number.isInteger(baseline))
    return baseline;
  throw new TypeError(REFUSED_BASELINE);
}
function isGlobList(value) {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}
function tokenFiles(tokens) {
  if (tokens === false)
    return [];
  if (isGlobList(tokens) && tokens.length > 0)
    return tokens;
  throw new TypeError(REFUSED_TOKENS);
}
var BASELINE_RULE = "plugin/use-baseline";
function passProperty(entry) {
  if (entry === null || entry === undefined)
    return entry;
  const [primary, options = {}] = Array.isArray(entry) ? entry : [entry];
  const ignored = Reflect.get(options, "ignoreAtRules") ?? [];
  if (!Array.isArray(ignored))
    return entry;
  return [primary, { ...options, ignoreAtRules: ["property", ...ignored] }];
}
function designTokens(files) {
  if (files.length === 0)
    return { rules: {}, overrides: [] };
  const off = Object.fromEntries(Object.keys(DESIGN_TOKENS).map((rule) => [rule, null]));
  return { rules: DESIGN_TOKENS, overrides: [{ files: [...files], rules: off }] };
}
function disallowedSelectors(noPageHas) {
  if (noPageHas === true)
    return { "selector-disallowed-list": [[...LANGUAGE_FREE_SELECTORS["selector-disallowed-list"], PAGE_HAS, CLASSLESS_HAS], { splitList: true }] };
  return LANGUAGE_FREE_SELECTORS;
}
function defineConfig({ baseline, tokens, bem, flatSelectors, noPageHas, rules, overrides = [], ...rest }) {
  const available = baselineTarget(baseline);
  const tokenRules = designTokens(tokenFiles(tokens));
  const merged = {
    ...CONVENTION_CHANGES,
    ...SELECTOR_COMPLEXITY,
    ...COMMENT_REFUSAL,
    ...disallowedSelectors(noPageHas),
    [BASELINE_RULE]: [true, { available }],
    ...tokenRules.rules,
    ...bem === true ? BEM_NAMES : null,
    ...flatSelectors === true ? FLAT_SELECTORS : null,
    ...rules
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
      ...overrides
    ]
  };
}
export {
  MARKUP,
  defineConfig
};
