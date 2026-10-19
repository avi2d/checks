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
var FLAT_SELECTORS = {
  "selector-max-type": 0,
  "selector-max-id": 0,
  "selector-max-compound-selectors": 2,
  "selector-max-attribute": 0
};
var PAGE_HAS = "/^(?=.*:has\\()(?=.*(?:^|[\\s>+~,([])(?:html|body|main)(?![\\w-])).*$/";
var DESIGN_TOKENS = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": COLOUR_FUNCTIONS.map((name) => `/^${name}$/i`),
  "declaration-property-value-allowed-list": { "/^font-size$/i": ["/^var\\(\\s*--[^\\s,()]+\\s*\\)$/i", "/^inherit$/i"] }
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
    return { "selector-disallowed-list": [...LANGUAGE_FREE_SELECTORS["selector-disallowed-list"], PAGE_HAS] };
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
    plugins: [peer("stylelint-plugin-use-baseline")],
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
