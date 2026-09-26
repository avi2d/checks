const COUNTED = { skipBlankLines: false, skipComments: false };

const FILE_LINES = {
  key: "fileLines",
  rule: "max-lines",
  options: COUNTED,
  measured: /has too many lines \((\d+)\)/,
  limits: "The most lines a file may hold, blank and comment lines counted",
} as const;

const FUNCTION_LINES = {
  key: "functionLines",
  rule: "max-lines-per-function",
  options: COUNTED,
  measured: /has too many lines \((\d+)\)/,
  limits: "The most lines a function may span, blank and comment lines counted",
} as const;

const STATEMENTS = {
  key: "statements",
  rule: "max-statements",
  options: {},
  measured: /has too many statements \((\d+)\)/,
  limits: "The most statements a function may hold",
} as const;

const COMPLEXITY = {
  key: "complexity",
  rule: "cognitive-complexity",
  plugin: "effect-channel",
  options: {},
  measured: /has a cognitive complexity of (\d+)/,
  limits: "The highest cognitive complexity a function may reach, a switch counted once",
} as const;

const DEPTH = {
  key: "depth",
  rule: "max-depth",
  options: {},
  measured: /nested too deeply \((\d+)\)/,
  limits: "The deepest a block may nest inside a function",
} as const;

export const SIZE_RULES = [FILE_LINES, FUNCTION_LINES, STATEMENTS, COMPLEXITY, DEPTH] as const;

export type SizeRule = (typeof SIZE_RULES)[number];
export type LimitKey = SizeRule["key"];

export function qualifiedName(rule: SizeRule): string {
  return "plugin" in rule ? `${rule.plugin}/${rule.rule}` : rule.rule;
}

export function diagnosticCode(rule: SizeRule): string {
  return "plugin" in rule ? `${rule.plugin}(${rule.rule})` : `eslint(${rule.rule})`;
}

// An absent limit turns its rule off.
export type Budget = { readonly [K in LimitKey]?: number };

export type Budgets = { readonly production: Budget; readonly tests: Budget };

export const SIZE_DEFAULTS = {
  production: { fileLines: 400, functionLines: 100, statements: 30, complexity: 15, depth: 4 },
  tests: { fileLines: 600, statements: 50, complexity: 15, depth: 4 },
} as const satisfies Budgets;

// An absent limit leaves the one set before it in place, as oxlint merges its overrides.
export type Limits = { readonly [K in LimitKey]?: number | "off" };

export type Scope = { readonly files: readonly string[]; readonly excludeFiles: readonly string[]; readonly limits: Limits };

export type Size = { readonly limits: Limits; readonly scopes: readonly Scope[] };

const TEST_GLOB = /(?:^|\/)tests\/|(?:[.](?:test|spec)|_test)[.][^/]*$/;

export function isTestGlob(glob: string): boolean {
  return TEST_GLOB.test(glob);
}

// oxlint matches a glob without a slash at any depth.
export function anyDepth(glob: string): string {
  return glob.includes("/") ? glob : `**/${glob}`;
}

function matches(globs: readonly string[], file: string): boolean {
  return globs.some((glob) => new Bun.Glob(glob).match(file));
}

export function budgetOf({ limits, scopes }: Size, file: string): Budget {
  const merged = scopes
    .filter((scope) => matches(scope.files, file) && !matches(scope.excludeFiles, file))
    .reduce<Limits>((all, scope) => ({ ...all, ...scope.limits }), limits);
  return Object.fromEntries(Object.entries(merged).flatMap(([key, limit]) => (typeof limit === "number" ? [[key, limit]] : []))) satisfies Budget;
}
