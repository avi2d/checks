import { Schema } from "effect";

export const TESTS_DIRECTORY = "tests";

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
  rule: "complexity",
  options: { variant: "modified" },
  measured: /has a complexity of (\d+)/,
  limits: "The highest cyclomatic complexity a function may reach, a switch counted once",
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

// An absent limit turns its rule off.
export type Budget = { readonly [K in LimitKey]?: number };

export type Budgets = { readonly production: Budget; readonly tests: Budget };

const APPLIES = ["ratchet", "changed", "all"] as const;
export type Applies = (typeof APPLIES)[number];

export const SIZE_DEFAULTS = {
  applies: "ratchet",
  production: { fileLines: 400, functionLines: 100, statements: 30, complexity: 15, depth: 4 },
  tests: { fileLines: 600, statements: 50, complexity: 15, depth: 4 },
} as const satisfies Budgets & { readonly applies: Applies };

const Limit = Schema.Int.check(Schema.isGreaterThan(0));

function limit({ limits }: SizeRule, fallback: number) {
  return Schema.optionalKey(Limit.annotate({ description: `${limits}; ${fallback} when absent` }));
}

const ProductionBudget = Schema.Struct({
  fileLines: limit(FILE_LINES, SIZE_DEFAULTS.production.fileLines),
  functionLines: limit(FUNCTION_LINES, SIZE_DEFAULTS.production.functionLines),
  statements: limit(STATEMENTS, SIZE_DEFAULTS.production.statements),
  complexity: limit(COMPLEXITY, SIZE_DEFAULTS.production.complexity),
  depth: limit(DEPTH, SIZE_DEFAULTS.production.depth),
});

const TestBudget = Schema.Struct({
  fileLines: limit(FILE_LINES, SIZE_DEFAULTS.tests.fileLines),
  statements: limit(STATEMENTS, SIZE_DEFAULTS.tests.statements),
  complexity: limit(COMPLEXITY, SIZE_DEFAULTS.tests.complexity),
  depth: limit(DEPTH, SIZE_DEFAULTS.tests.depth),
});

const FLAT_KEYS = ["fileLines", "functionLines"] as const;

function flatKeys(size: { readonly [K in (typeof FLAT_KEYS)[number]]?: number }): readonly string[] {
  return FLAT_KEYS.filter((key) => size[key] !== undefined);
}

function them(keys: readonly string[]): string {
  return keys.length === 1 ? "it" : "them";
}

export const Size = Schema.Struct({
  applies: Schema.optionalKey(
    Schema.Literals(APPLIES).annotate({
      description: `Which production and test files the budget holds: ratchet, the ones a range adds or changes, to no more overrun per rule than at the range's base; changed, the same ones, to the whole budget; all, every one. ${SIZE_DEFAULTS.applies} when absent. The rest are listed as advisory`,
    }),
  ),
  production: Schema.optionalKey(
    ProductionBudget.annotate({
      description: `The budget of the files under sources.production, and of the files listed as advisory outside ${TESTS_DIRECTORY}/`,
    }),
  ),
  tests: Schema.optionalKey(
    TestBudget.annotate({ description: `The budget of the files under ${TESTS_DIRECTORY}/, which sets no limit on a function's lines` }),
  ),
  fileLines: Schema.optionalKey(
    Limit.annotate({ description: "production.fileLines as first spelled, which a later minor release stops reading" }),
  ),
  functionLines: Schema.optionalKey(
    Limit.annotate({ description: "production.functionLines as first spelled, which a later minor release stops reading" }),
  ),
})
  .annotate({ description: "The size budget oxlint holds production and test files to, read by checks-size-budget" })
  .check(
    Schema.makeFilter(
      (size) => {
        const beside = flatKeys(size);
        if (size.production === undefined || beside.length === 0) return true;
        return `sets ${beside.join(" and ")} beside production, which holds the same budget; move ${them(beside)} into production`;
      },
      { toJsonSchema: () => ({ not: { required: ["production"], anyOf: FLAT_KEYS.map((key) => ({ required: [key] })) } }) },
    ),
  );
export type Size = typeof Size.Type;

export function flatKeysNotice(source: string, size: Size): readonly string[] {
  const flat = flatKeys(size);
  if (flat.length === 0) return [];
  const keys = flat.map((key) => `size.${key}`).join(" and ");
  return [`${source} sets ${keys}, which a later minor release stops reading; move ${them(flat)} into size.production`];
}

export function budgetsOf(size: Size): Budgets {
  const { fileLines, functionLines } = size;
  return {
    production: {
      ...SIZE_DEFAULTS.production,
      ...(fileLines === undefined ? {} : { fileLines }),
      ...(functionLines === undefined ? {} : { functionLines }),
      ...size.production,
    },
    tests: { ...SIZE_DEFAULTS.tests, ...size.tests },
  };
}

export function budgetOf({ production, tests }: Budgets, file: string): Budget {
  return file.startsWith(`${TESTS_DIRECTORY}/`) ? tests : production;
}
