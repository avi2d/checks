const FILE_LINES = {
  rule: "max-lines",
  limits: "The most lines a file may hold, blank and comment lines counted",
} as const;

const FUNCTION_LINES = {
  rule: "max-lines-per-function",
  limits: "The most lines a function may span, blank and comment lines counted",
} as const;

const STATEMENTS = {
  rule: "max-statements",
  limits: "The most statements a function may hold",
} as const;

const COMPLEXITY = {
  rule: "cognitive-complexity",
  plugin: "readability",
  limits: "The highest cognitive complexity a function may reach, a switch counted once",
} as const;

const DEPTH = {
  rule: "max-depth",
  limits: "The deepest a block may nest inside a function",
} as const;

export const SIZE_RULES = [FILE_LINES, FUNCTION_LINES, STATEMENTS, COMPLEXITY, DEPTH] as const;

export type SizeRule = (typeof SIZE_RULES)[number];
export function qualifiedName(rule: SizeRule): string {
  return "plugin" in rule ? `${rule.plugin}/${rule.rule}` : rule.rule;
}
