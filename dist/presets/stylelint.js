// src/quality/presets/stylelint.ts
import { fileURLToPath } from "node:url";
import valueParser from "postcss-value-parser";
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
var ONE_VAR = new RegExp(`^${VAR}$`, "i");
var FONT_STYLE_VARIANT_OR_WIDTH = "(?:normal|italic|oblique(?:\\s+-?[\\d.]+(?:deg|grad|rad|turn))?|small-caps|(?:ultra-|extra-|semi-)?(?:condensed|expanded))";
var FONT_WEIGHT_LITERAL = "(?:bold|bolder|lighter|[1-9]\\d*(?:\\.\\d+)?)";
var FONT_FAMILY = `(?:"[^"]*"|'[^']*'|${VAR}|-?[a-z_][\\w-]*(?:\\s+-?[a-z_][\\w-]*)*)`;
var FONT_FAMILIES = `${FONT_FAMILY}(?:\\s*,\\s*${FONT_FAMILY})*`;
var FONT_FAMILY_VALUE = new RegExp(`^${FONT_FAMILIES}$`, "i");
var NAMED_FONT_SIZES = new Set([
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
  "math"
]);
var SIZE_PRECEDER = new RegExp(`^(?:${FONT_STYLE_VARIANT_OR_WIDTH}|${FONT_WEIGHT_LITERAL})$`, "i");
var FONT_VALUE = new RegExp(`^(?:${FONT_STYLE_VARIANT_OR_WIDTH}\\s+)*(?<size>${VAR})(?<lineHeight>\\s*\\/\\s*${VAR})?(?:\\s+(?<families>${FONT_FAMILIES}))?$`, "i");
var FONT_SIZE_RULE = "checks/font-size-from-tokens";
function varNames(value) {
  return [...value.matchAll(VAR_NAMES)].map(([, name]) => name).filter((name) => name !== undefined);
}
function sizePosition(families) {
  const position = valueParser(families).nodes.find(({ type, value }) => type !== "space" && !(type === "word" && SIZE_PRECEDER.test(value)));
  return position === undefined ? "" : valueParser.stringify(position);
}
function fontSizePosition(font) {
  return font.lineHeight === undefined ? sizePosition(font.families ?? "") : "";
}
function namedSize(position) {
  return NAMED_FONT_SIZES.has(position.toLowerCase()) ? position : undefined;
}
function sizeCarriers({ prop: property, value }) {
  const name = property.toLowerCase();
  if (name === "font-size")
    return oneVarCarriers(value);
  const font = name === "font" ? FONT_VALUE.exec(value)?.groups : undefined;
  if (font?.size === undefined)
    return [];
  const atSize = varNames(fontSizePosition(font));
  return [
    ...varNames(font.size).map((token) => ({ token, setTo: ONE_VAR, atSize: false })),
    ...varNames(font.families ?? "").map((token) => ({ token, setTo: FONT_FAMILY_VALUE, atSize: atSize.includes(token) }))
  ];
}
function literalSize(property, value) {
  const font = property.toLowerCase() === "font" ? FONT_VALUE.exec(value)?.groups : undefined;
  return font?.size === undefined ? undefined : namedSize(fontSizePosition(font));
}
function fromTokens({ token, setTo, atSize }, declared, seen) {
  const values = declared.get(token);
  if (values === undefined)
    return true;
  return values.every((value) => {
    const position = atSize ? sizePosition(value) : "";
    return setTo.test(value) && namedSize(position) === undefined && varNames(value).every((alias) => !seen.has(alias) && fromTokens({ token: alias, setTo, atSize: varNames(position).includes(alias) }, declared, new Set([...seen, alias])));
  });
}
var declaredByFile = new WeakMap;
function fileDeclarations(document) {
  const cached = declaredByFile.get(document);
  if (cached !== undefined)
    return cached;
  const fresh = new Map;
  document.walkDecls(/^--/, ({ prop, value }) => {
    fresh.set(prop, [...fresh.get(prop) ?? [], value]);
  });
  declaredByFile.set(document, fresh);
  return fresh;
}
function tokenPlugin({ ruleName, literals, carriers }) {
  const rule = () => async (root, result) => {
    const { utils } = (await import("stylelint")).default;
    const declared = fileDeclarations(result.root);
    root.walkDecls((node) => {
      for (const { word, message } of literals(node))
        utils.report({ ruleName, result, node, word, message });
      for (const carrier of carriers(node)) {
        if (fromTokens(carrier, declared, new Set([carrier.token])))
          continue;
        utils.report({ ruleName, result, node, word: carrier.token, message: `Expected "${carrier.token}" from the token files rather than set in this file` });
      }
    });
  };
  return { ruleName, rule: Object.assign(rule, { ruleName, messages: {} }) };
}
function fontSizeLiterals({ prop: property, value }) {
  const literal = literalSize(property, value);
  return literal === undefined ? [] : [{ word: literal, message: `Expected the font size from the token files rather than the literal "${literal}"` }];
}
function oneVarCarriers(value) {
  return ONE_VAR.test(value) ? varNames(value).map((token) => ({ token, setTo: ONE_VAR, atSize: false })) : [];
}
function shorthandLineHeight(property, value) {
  const lineHeight = property.toLowerCase() === "font" ? FONT_VALUE.exec(value)?.groups?.lineHeight : undefined;
  return varNames(lineHeight ?? "").map((token) => ({ token, setTo: ONE_VAR, atSize: false }));
}
var TYPE_PROPERTIES = [
  { property: "line-height", keywords: ["inherit"] },
  { property: "letter-spacing", keywords: ["inherit", "normal"] },
  { property: "font-weight", keywords: ["inherit"] },
  { property: "text-transform", keywords: ["inherit", "none"] }
];
function typeRuleName(property) {
  return `checks/${property}-from-tokens`;
}
function typePropertyCarriers(property) {
  return ({ prop: name, value }) => [
    ...name.toLowerCase() === property ? oneVarCarriers(value) : [],
    ...property === "line-height" ? shorthandLineHeight(name, value) : []
  ];
}
function usesAllowedList(property) {
  return property !== "font-weight";
}
var FONT_WEIGHT_KEYWORDS = TYPE_PROPERTIES.find((entry) => entry.property === "font-weight")?.keywords ?? [];
function isFontFaceDescriptor(node) {
  return node.parent?.type === "atrule" && node.parent.name?.toLowerCase() === "font-face";
}
function fontWeightLiterals(node) {
  if (node.prop.toLowerCase() !== "font-weight" || isFontFaceDescriptor(node))
    return [];
  if (ONE_VAR.test(node.value) || FONT_WEIGHT_KEYWORDS.some((keyword) => keyword === node.value.toLowerCase()))
    return [];
  return [{ word: node.value, message: `Expected the font weight from the token files rather than the literal "${node.value}"` }];
}
function fontWeightCarriers(node) {
  if (node.prop.toLowerCase() !== "font-weight" || isFontFaceDescriptor(node))
    return [];
  return oneVarCarriers(node.value);
}
var TOKEN_PLUGINS = [
  tokenPlugin({ ruleName: FONT_SIZE_RULE, literals: fontSizeLiterals, carriers: sizeCarriers }),
  ...TYPE_PROPERTIES.map(({ property }) => usesAllowedList(property) ? tokenPlugin({ ruleName: typeRuleName(property), literals: () => [], carriers: typePropertyCarriers(property) }) : tokenPlugin({ ruleName: typeRuleName(property), literals: fontWeightLiterals, carriers: fontWeightCarriers }))
];
var DESIGN_TOKENS = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": COLOUR_FUNCTIONS.map((name) => `/^${name}$/i`),
  "declaration-property-value-allowed-list": {
    "/^font-size$/i": [String(ONE_VAR), "/^inherit$/i"],
    "/^font$/i": [String(FONT_VALUE), "/^inherit$/i"],
    ...Object.fromEntries(TYPE_PROPERTIES.filter(({ property }) => usesAllowedList(property)).map(({ property, keywords }) => [
      `/^${property}$/i`,
      [String(ONE_VAR), ...keywords.map((keyword) => `/^${keyword}$/i`)]
    ]))
  },
  ...Object.fromEntries(TOKEN_PLUGINS.map(({ ruleName }) => [ruleName, true]))
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
    plugins: [peer("stylelint-plugin-use-baseline"), ...TOKEN_PLUGINS],
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
