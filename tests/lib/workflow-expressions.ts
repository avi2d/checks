import { Evaluator, Lexer, Parser, data } from "@actions/expressions";

export const EXPRESSION = "$";

export type Plain = string | { readonly [key: string]: Plain };

const dictionaryOf = (record: { readonly [key: string]: Plain }): data.Dictionary =>
  new data.Dictionary(...Object.entries(record).map(([key, inner]) => ({ key, value: typeof inner === "string" ? new data.StringData(inner) : dictionaryOf(inner) })));

const runnerFunctions = new Map([["always", { name: "always", minArgs: 0, maxArgs: 0, call: (): data.ExpressionData => new data.BooleanData(true) }]]);

export const evaluated = (expression: string, contexts: Readonly<Record<string, Plain>>): data.ExpressionData => {
  const inner = expression.startsWith(EXPRESSION + "{{") && expression.endsWith("}}") ? expression.slice(3, -2).trim() : expression;
  const parser = new Parser(new Lexer(inner).lex().tokens, Object.keys(contexts), [...runnerFunctions.values()]);
  return new Evaluator(parser.parse(), dictionaryOf(contexts), runnerFunctions).evaluate();
};

export const truthy = (result: data.ExpressionData): boolean => (result.kind === data.Kind.Boolean ? result.value : result.coerceString() !== "");

const STATUS_FUNCTION = /\b(?:success|failure|cancelled|always)\(\)/;

const statusFunction = (name: string, value: boolean) => ({ name, minArgs: 0, maxArgs: 0, call: (): data.ExpressionData => new data.BooleanData(value) });

export const jobRuns = (expression: string, contexts: Readonly<Record<string, Plain>>, everyAncestorSucceeded: boolean): boolean => {
  const inner = expression.startsWith(EXPRESSION + "{{") && expression.endsWith("}}") ? expression.slice(3, -2).trim() : expression;
  const checked = STATUS_FUNCTION.test(inner) ? inner : `success() && (${inner})`;
  const functions = new Map([
    ["always", statusFunction("always", true)],
    ["cancelled", statusFunction("cancelled", false)],
    ["failure", statusFunction("failure", false)],
    ["success", statusFunction("success", everyAncestorSucceeded)],
  ]);
  const parser = new Parser(new Lexer(checked).lex().tokens, Object.keys(contexts), [...functions.values()]);
  return truthy(new Evaluator(parser.parse(), dictionaryOf(contexts), functions).evaluate());
};
