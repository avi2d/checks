import { expect, test } from "bun:test";
import { cognitiveComplexity, type SelfNames } from "../effect-channel/cognitive.ts";
import {
  CALL_TYPES,
  CONTROL_TYPES,
  FUNCTION_TYPES,
  LOOP_TYPES,
  PLAIN_A_TYPES,
  PLAIN_B_TYPES,
  PLAIN_C_TYPES,
} from "../effect-channel/cognitive-nodes.ts";
import type { Arrow, NamedFunction, Static, SyntaxNode } from "../effect-channel/cognitive-nodes.ts";

const id = (name: string): SyntaxNode => ({ type: "Identifier", name });
const lit = (): SyntaxNode => ({ type: "Literal" });
const block = (...body: SyntaxNode[]): SyntaxNode => ({ type: "BlockStatement", body });
const ret = (argument: SyntaxNode | null = null): SyntaxNode => ({ type: "ReturnStatement", argument });
const expr = (expression: SyntaxNode): SyntaxNode => ({ type: "ExpressionStatement", expression });
const ifs = (condition: SyntaxNode, consequent: SyntaxNode, alternate: SyntaxNode | null = null): SyntaxNode => ({
  type: "IfStatement",
  test: condition,
  consequent,
  alternate,
});
const cond = (condition: SyntaxNode, consequent: SyntaxNode, alternate: SyntaxNode): SyntaxNode => ({
  type: "ConditionalExpression",
  test: condition,
  consequent,
  alternate,
});
const seq = (operator: string, left: SyntaxNode, right: SyntaxNode): SyntaxNode => ({
  type: "LogicalExpression",
  left,
  operator,
  right,
});
const call = (name: string, ...args: SyntaxNode[]): SyntaxNode => ({
  type: "CallExpression",
  callee: id(name),
  arguments: args,
});
const fn = (...body: SyntaxNode[]): NamedFunction => ({
  type: "FunctionDeclaration",
  id: null,
  params: [],
  body: block(...body),
});
const arrow = (...body: SyntaxNode[]): Arrow => ({ type: "ArrowFunctionExpression", params: [], body: block(...body) });
const staticBlock = (...body: SyntaxNode[]): Static => ({ type: "StaticBlock", body });
const NO_NAMES: SelfNames = { identifiers: [], members: [] };

function scoreOf(...body: SyntaxNode[]): number {
  return cognitiveComplexity(fn(...body), NO_NAMES);
}

test("every node type routes to exactly one category", () => {
  const groups = [CONTROL_TYPES, LOOP_TYPES, CALL_TYPES, FUNCTION_TYPES, PLAIN_A_TYPES, PLAIN_B_TYPES, PLAIN_C_TYPES];
  const seen = new Map<string, number>();
  for (const group of groups) {
    for (const type of group) seen.set(type, (seen.get(type) ?? 0) + 1);
  }
  for (const [, count] of seen) expect(count).toBe(1);
});

test("a flat guard costs one, and an else costs one more", () => {
  expect(scoreOf(expr(ifs(id("a"), block(ret(lit())))))).toBe(1);
  expect(scoreOf(expr(ifs(id("a"), block(ret(lit())), block(ret(lit())))))).toBe(2);
});

test("an else-if chain pays the initial if and one per else and else-if", () => {
  const chain = ifs(id("a"), block(ret(lit())), ifs(id("b"), block(ret(lit())), ifs(id("c"), block(ret(lit())), block(ret(lit())))));
  expect(scoreOf(expr(chain))).toBe(4);
});

test("every branch of an else-if chain sits one level below the if", () => {
  const nestedInThird = ifs(id("a"), block(), ifs(id("b"), block(), ifs(id("c"), block(expr(ifs(id("x"), block()))))));
  expect(scoreOf(expr(nestedInThird))).toBe(5);
  const nestedInElse = ifs(id("a"), block(), ifs(id("b"), block(), ifs(id("c"), block(), ifs(id("d"), block(), block(expr(ifs(id("x"), block())))))));
  expect(scoreOf(expr(nestedInElse))).toBe(7);
  const loop: SyntaxNode = { type: "ForStatement", init: null, test: id("t"), update: null, body: block(expr(ifs(id("x"), block()))) };
  const deepLink = ifs(id("a"), block(), ifs(id("b"), block(), ifs(id("c"), block(), ifs(id("d"), block(), ifs(id("e"), block(loop))))));
  expect(scoreOf(expr(deepLink))).toBe(10);
});

test("an else-if condition scores at the level of the if's condition", () => {
  expect(scoreOf(expr(ifs(cond(id("a"), id("b"), id("c")), block())))).toBe(2);
  expect(scoreOf(expr(ifs(id("a"), block(), ifs(cond(id("b"), id("c"), id("d")), block()))))).toBe(3);
});

test("an explicit else holding an if pays the else and the nested if", () => {
  const nested = ifs(id("a"), block(ret(lit())), block(expr(ifs(id("b"), block(ret(lit()))))));
  expect(scoreOf(expr(nested))).toBe(4);
});

test("a ternary costs one, and a nested ternary pays its nesting", () => {
  expect(scoreOf(ret(cond(id("a"), lit(), lit())))).toBe(1);
  expect(scoreOf(ret(cond(id("a"), cond(id("b"), lit(), lit()), lit())))).toBe(3);
});

test("a switch and all its cases cost one", () => {
  const cases: SyntaxNode[] = [
    { type: "SwitchCase", test: lit(), consequent: [ret(lit())] },
    { type: "SwitchCase", test: lit(), consequent: [ret(lit())] },
    { type: "SwitchCase", test: null, consequent: [ret(lit())] },
  ];
  expect(scoreOf({ type: "SwitchStatement", discriminant: id("x"), cases })).toBe(1);
});

test("each loop costs one before nesting", () => {
  const body = block(ret(lit()));
  expect(scoreOf({ type: "WhileStatement", test: id("c"), body })).toBe(1);
  expect(scoreOf({ type: "DoWhileStatement", body, test: id("c") })).toBe(1);
  expect(scoreOf({ type: "ForInStatement", left: id("k"), right: id("o"), body })).toBe(1);
  expect(scoreOf({ type: "ForOfStatement", left: id("k"), right: id("o"), body })).toBe(1);
  expect(scoreOf({ type: "ForStatement", init: null, test: id("c"), update: null, body })).toBe(1);
});

test("try and finally cost nothing, and a catch costs one", () => {
  const attempt: SyntaxNode = {
    type: "TryStatement",
    block: block(ret(lit())),
    handler: { type: "CatchClause", param: null, body: block(ret(lit())) },
    finalizer: block(expr(call("cleanup"))),
  };
  expect(scoreOf(attempt)).toBe(1);
});

test("a run of like operators costs one, and each new run costs one more", () => {
  expect(scoreOf(ret(seq("&&", id("a"), id("b"))))).toBe(1);
  expect(scoreOf(ret(seq("&&", seq("&&", seq("&&", id("a"), id("b")), id("c")), id("d"))))).toBe(1);
  expect(scoreOf(ret(seq("||", seq("||", id("a"), seq("&&", id("b"), id("c"))), id("d"))))).toBe(2);
  expect(scoreOf(ret(seq("||", seq("||", seq("&&", seq("&&", id("a"), id("b")), id("c")), id("d")), seq("&&", id("e"), id("f")))))).toBe(3);
});

test("a parenthesised run counts apart from the run around it", () => {
  const inner: SyntaxNode = { type: "ParenthesizedExpression", expression: seq("&&", id("b"), id("c")) };
  expect(scoreOf(ret(seq("&&", id("a"), inner)))).toBe(2);
  expect(scoreOf(ret({ type: "UnaryExpression", argument: inner }))).toBe(1);
});

test("nullish coalescing and optional chaining cost nothing", () => {
  expect(scoreOf(ret(seq("??", id("a"), id("b"))))).toBe(0);
  expect(scoreOf(ret(seq("&&", seq("??", id("a"), id("b")), id("c"))))).toBe(1);
  expect(scoreOf(ret({ type: "ChainExpression", expression: id("a") }))).toBe(0);
});

test("a plain jump costs nothing, and a labelled one costs one", () => {
  const loop = (jump: SyntaxNode): SyntaxNode => ({ type: "WhileStatement", test: id("c"), body: block(expr(jump)) });
  expect(scoreOf(loop({ type: "BreakStatement", label: null }))).toBe(1);
  expect(scoreOf(loop({ type: "ContinueStatement", label: null }))).toBe(1);
  expect(scoreOf({ type: "LabeledStatement", body: loop({ type: "BreakStatement", label: id("outer") }) })).toBe(2);
  expect(scoreOf({ type: "LabeledStatement", body: loop({ type: "ContinueStatement", label: id("outer") }) })).toBe(2);
});

test("a direct self call costs one, and a call through a nested function does not", () => {
  const body: SyntaxNode = ret(cond(call("f", id("n")), lit(), lit()));
  expect(cognitiveComplexity({ ...fn(), body: block(expr(body)) }, { identifiers: ["f"], members: [] })).toBe(2);
  const nested: SyntaxNode = arrow(expr(call("f", id("n"))));
  expect(cognitiveComplexity(fn(expr(nested)), { identifiers: ["f"], members: [] })).toBe(0);
});

test("a bare call to a member's own name is not recursion", () => {
  const body: SyntaxNode = ret(cond(call("parse", id("s")), lit(), lit()));
  expect(cognitiveComplexity(fn(expr(body)), { identifiers: [], members: ["parse"] })).toBe(1);
});

test("a method calling itself through this costs one", () => {
  const callee: SyntaxNode = {
    type: "MemberExpression",
    object: { type: "ThisExpression" },
    property: id("run"),
  };
  const body: SyntaxNode = ret(cond({ type: "CallExpression", callee, arguments: [] }, lit(), lit()));
  expect(cognitiveComplexity(fn(expr(body)), { identifiers: [], members: ["run"] })).toBe(2);
  expect(cognitiveComplexity(fn(expr(body)), { identifiers: ["run"], members: [] })).toBe(1);
});

test("nesting adds one per level around each break in the flow", () => {
  const deep = ifs(id("a"), block(expr(ifs(id("b"), block(expr(ifs(id("c"), block(ret(lit())))))))));
  expect(scoreOf(expr(deep))).toBe(6);
});

test("an else-if under nesting keeps its hybrid increment while the inner if pays the level", () => {
  const inner = ifs(id("d"), block(ret(lit())), block(ret(lit())));
  const chain = ifs(id("b"), block(ret(lit())), ifs(id("c"), block(expr(inner)), block(ret(lit()))));
  expect(scoreOf({ type: "WhileStatement", test: id("a"), body: block(expr(chain)) })).toBe(9);
});

test("a nested function raises the nesting without costing a structural increment", () => {
  const inner = arrow(expr(ifs(id("c"), block(ret(lit())))));
  expect(scoreOf(expr(inner))).toBe(2);
  expect(cognitiveComplexity(inner, NO_NAMES)).toBe(1);
});

test("an object method and a class field raise the nesting the same way", () => {
  const method: SyntaxNode = { type: "Property", key: id("run"), value: arrow(expr(ifs(id("c"), block(ret(lit()))))) };
  expect(scoreOf(expr(method))).toBe(2);
  const field: SyntaxNode = { type: "PropertyDefinition", key: id("run"), value: arrow(expr(ifs(id("c"), block(ret(lit()))))) };
  const klass: SyntaxNode = {
    type: "ClassDeclaration",
    decorators: [],
    id: id("Box"),
    superClass: null,
    body: { type: "ClassBody", body: [field] },
  };
  expect(scoreOf(klass)).toBe(2);
});

test("a class of plain methods costs nothing to enter", () => {
  const method: SyntaxNode = {
    type: "MethodDefinition",
    key: id("label"),
    value: { type: "FunctionExpression", id: null, params: [], body: block(ret(lit())) },
  };
  const klass: SyntaxNode = {
    type: "ClassDeclaration",
    decorators: [],
    id: id("Box"),
    superClass: null,
    body: { type: "ClassBody", body: [method] },
  };
  expect(scoreOf(klass)).toBe(0);
});

test("a static block scores its own body", () => {
  expect(cognitiveComplexity(staticBlock(expr(ifs(id("c"), block(ret(lit()))))), NO_NAMES)).toBe(1);
});

test("assignments, defaults and destructuring pass their expressions through", () => {
  expect(scoreOf(expr({ type: "AssignmentExpression", left: id("x"), right: seq("&&", id("a"), id("b")) }))).toBe(1);
  expect(scoreOf(expr({ type: "AssignmentExpression", left: id("x"), right: seq("||", id("a"), id("b")) }))).toBe(1);
  const param: SyntaxNode = { type: "AssignmentPattern", left: id("a"), right: seq("||", id("x"), id("y")) };
  const withDefault: NamedFunction = { ...fn(ret(lit())), params: [param] };
  expect(cognitiveComplexity(withDefault, NO_NAMES)).toBe(1);
  const destructured: NamedFunction = {
    ...fn(ret(lit())),
    params: [
      { type: "ObjectPattern", properties: [{ type: "Property", key: id("a"), value: param }] },
      { type: "ArrayPattern", elements: [id("b"), { type: "RestElement", argument: id("c") }] },
    ],
  };
  expect(cognitiveComplexity(destructured, NO_NAMES)).toBe(1);
});

test("declarations, arrays, templates and sequences pass their expressions through", () => {
  expect(scoreOf({ type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: id("i"), init: seq("&&", id("a"), id("b")) }] })).toBe(1);
  expect(scoreOf(ret({ type: "ArrayExpression", elements: [seq("&&", id("a"), id("b")), null] }))).toBe(1);
  expect(scoreOf(ret({ type: "TemplateLiteral", expressions: [seq("&&", id("a"), id("b"))] }))).toBe(1);
  expect(scoreOf(ret({ type: "SequenceExpression", expressions: [id("a"), seq("&&", id("b"), id("c"))] }))).toBe(1);
  expect(scoreOf(ret({ type: "BinaryExpression", left: id("a"), right: id("b") }))).toBe(0);
  expect(scoreOf({ type: "ThrowStatement", argument: id("e") })).toBe(0);
});

test("wrappers, members, calls and awaits pass their expressions through", () => {
  expect(scoreOf(ret({ type: "ParenthesizedExpression", expression: seq("&&", id("a"), id("b")) }))).toBe(1);
  expect(scoreOf(ret({ type: "MemberExpression", object: id("a"), property: id("b") }))).toBe(0);
  expect(scoreOf(ret({ type: "NewExpression", callee: id("Box"), arguments: [seq("&&", id("a"), id("b"))] }))).toBe(1);
  expect(scoreOf(ret({ type: "AwaitExpression", argument: seq("&&", id("a"), id("b")) }))).toBe(1);
  expect(scoreOf(ret({ type: "YieldExpression", argument: seq("&&", id("a"), id("b")) }))).toBe(1);
  expect(scoreOf(ret({ type: "ImportExpression", source: lit(), options: null }))).toBe(0);
  expect(scoreOf(ret({ type: "TaggedTemplateExpression", tag: id("tag"), quasi: { type: "TemplateLiteral", expressions: [seq("&&", id("a"), id("b"))] } }))).toBe(1);
  expect(scoreOf({ type: "WithStatement", object: id("o"), body: block(expr(ifs(id("c"), block(ret(lit()))))) })).toBe(1);
});

test("a handler arrow inside JSX scores through its nesting", () => {
  const handler: SyntaxNode = {
    type: "JSXExpressionContainer",
    expression: arrow(expr(ifs(id("c"), block(ret(lit()))))),
  };
  const element: SyntaxNode = {
    type: "JSXElement",
    openingElement: { type: "JSXOpeningElement", attributes: [{ type: "JSXAttribute", value: handler }] },
    children: [{ type: "JSXFragment", children: [] }],
  };
  expect(scoreOf(ret(element))).toBe(2);
});

test("an enum member with a logical initializer costs one", () => {
  const member: SyntaxNode = { type: "TSEnumMember", initializer: seq("||", id("a"), id("b")) };
  const declaration: SyntaxNode = { type: "TSEnumDeclaration", body: { type: "TSEnumBody", members: [member] } };
  expect(scoreOf(declaration)).toBe(1);
});

test("the paper's prime sieve scores seven", () => {
  const continued: SyntaxNode = { type: "ContinueStatement", label: id("OUT") };
  const divisible = ifs(id("divisible"), block(expr(continued)));
  const inner: SyntaxNode = { type: "ForStatement", init: null, test: id("t"), update: null, body: block(expr(divisible)) };
  const outer: SyntaxNode = { type: "ForStatement", init: null, test: id("t"), update: null, body: block(expr(inner)) };
  expect(scoreOf({ type: "LabeledStatement", body: expr(outer) })).toBe(7);
});

test("the paper's word list scores one", () => {
  const cases: SyntaxNode[] = [
    { type: "SwitchCase", test: lit(), consequent: [ret(lit())] },
    { type: "SwitchCase", test: lit(), consequent: [ret(lit())] },
    { type: "SwitchCase", test: lit(), consequent: [ret(lit())] },
    { type: "SwitchCase", test: null, consequent: [ret(lit())] },
  ];
  const named: NamedFunction = {
    type: "FunctionDeclaration",
    id: id("getWords"),
    params: [id("number")],
    body: block({ type: "SwitchStatement", discriminant: id("number"), cases }),
  };
  expect(cognitiveComplexity(named, { identifiers: ["getWords"], members: [] })).toBe(1);
});
