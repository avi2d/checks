/*!
Adapted from the no-reduce-accumulator-copy rule of anti-slop, https://github.com/dmmulroy/anti-slop

MIT License

Copyright (c) 2026 Dillon Mulroy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import type { CreateRule, ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

type Callback = ESTree.ArrowFunctionExpression | ESTree.Function;

type Reducer = { readonly accumulator: Variable; readonly initialValue: ESTree.Node | undefined };

type Method = { readonly name: string; readonly object: ESTree.Node };

const REDUCERS: ReadonlySet<string> = new Set(["reduce", "reduceRight"]);

const ARRAY_COPIES: ReadonlySet<string> = new Set(["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"]);

const ARRAY_RESULTS: ReadonlySet<string> = new Set(["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"]);

const ARRAY_TYPE_NAMES: ReadonlySet<string> = new Set(["Array", "ReadonlyArray"]);

function unwrap(node: ESTree.Node): ESTree.Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "ChainExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }
  return current;
}

// Resolved by scope rather than by spelling, so an inner binding that shadows the accumulator, `Object` or `Array` is a different variable.
function binding(sourceCode: SourceCode, node: ESTree.Node): Variable | undefined {
  const target = unwrap(node);
  if (target.type !== "Identifier") return undefined;
  let scope: Scope | null = sourceCode.getScope(target);
  while (scope !== null) {
    const variable = scope.set.get(target.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return undefined;
}

function methodOf(callee: ESTree.Node): Method | undefined {
  const member = unwrap(callee);
  if (member.type !== "MemberExpression") return undefined;
  const { property } = member;
  if (!member.computed && property.type === "Identifier") return { name: property.name, object: member.object };
  if (member.computed && property.type === "Literal" && typeof property.value === "string") {
    return { name: property.value, object: member.object };
  }
  return undefined;
}

function reassigned(variable: Variable): boolean {
  return variable.references.some((reference) => reference.isWrite() && !reference.init);
}

function constInit(variable: Variable): ESTree.Node | undefined {
  for (const definition of variable.defs) {
    const { node } = definition;
    if (definition.type !== "Variable" || node.type !== "VariableDeclarator") continue;
    if (node.id.type !== "Identifier" || node.init === null) continue;
    if (node.parent.type === "VariableDeclaration" && node.parent.kind === "const") return node.init;
  }
  return undefined;
}

function readsAccumulator(sourceCode: SourceCode, node: ESTree.Node, accumulator: Variable, seen: Set<Variable>): boolean {
  const variable = binding(sourceCode, node);
  if (variable === undefined || seen.has(variable)) return false;
  if (variable === accumulator) return true;
  seen.add(variable);
  if (reassigned(variable)) return false;
  const init = constInit(variable);
  return init !== undefined && readsAccumulator(sourceCode, init, accumulator, seen);
}

function isArrayType(type: ESTree.TSType): boolean {
  if (type.type === "TSArrayType" || type.type === "TSTupleType") return true;
  if (type.type === "TSParenthesizedType") return isArrayType(type.typeAnnotation);
  if (type.type === "TSTypeOperator" && type.operator === "readonly") return isArrayType(type.typeAnnotation);
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && ARRAY_TYPE_NAMES.has(type.typeName.name);
}

function annotation(variable: Variable): ESTree.TSType | undefined {
  for (const identifier of variable.identifiers) {
    if ("typeAnnotation" in identifier && identifier.typeAnnotation) return identifier.typeAnnotation.typeAnnotation;
  }
  return undefined;
}

// An unknown receiver stays unknown, so a string or a custom collection with a `concat` passes.
function isKnownArray(sourceCode: SourceCode, node: ESTree.Node, seen: Set<Variable>): boolean {
  const value = unwrap(node);
  if (value.type === "ArrayExpression") return true;
  if (value.type === "CallExpression") {
    const method = methodOf(value.callee);
    return method !== undefined && ARRAY_RESULTS.has(method.name) && isKnownArray(sourceCode, method.object, seen);
  }
  const variable = binding(sourceCode, value);
  if (variable === undefined || seen.has(variable)) return false;
  seen.add(variable);
  if (reassigned(variable)) return false;
  const type = annotation(variable);
  if (type !== undefined) return isArrayType(type);
  const init = constInit(variable);
  return init !== undefined && isKnownArray(sourceCode, init, seen);
}

function isCallback(node: ESTree.Node): node is Callback {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function nearestFunction(node: ESTree.Node): Callback | undefined {
  let current = node.parent;
  while (current !== null) {
    if (current.type === "FunctionDeclaration") return undefined;
    if (isCallback(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function reducerCall(callback: Callback): ESTree.CallExpression | undefined {
  let owner: ESTree.Node | null = callback.parent;
  while (owner !== null && unwrap(owner) === callback) owner = owner.parent;
  if (owner?.type !== "CallExpression" || owner.arguments.length > 2) return undefined;
  const method = methodOf(owner.callee);
  const [first] = owner.arguments;
  if (method === undefined || !REDUCERS.has(method.name) || first === undefined) return undefined;
  return unwrap(first) === callback ? owner : undefined;
}

// Only the nearest function counts, so a copy inside a helper the reducer declares is not a copy per step.
function enclosingReducer(sourceCode: SourceCode, node: ESTree.Node): Reducer | undefined {
  const callback = nearestFunction(node);
  if (callback === undefined) return undefined;
  const call = reducerCall(callback);
  if (call === undefined) return undefined;
  const [first] = callback.params;
  const parameter = first?.type === "AssignmentPattern" ? first.left : first;
  if (parameter?.type !== "Identifier") return undefined;
  const accumulator = sourceCode
    .getDeclaredVariables(callback)
    .find((variable) => variable.identifiers.some((identifier) => identifier.start === parameter.start));
  return accumulator === undefined ? undefined : { accumulator, initialValue: call.arguments[1] };
}

function isGlobal(sourceCode: SourceCode, node: ESTree.Node, name: string): boolean {
  const owner = unwrap(node);
  if (owner.type !== "Identifier" || owner.name !== name) return false;
  const variable = binding(sourceCode, owner);
  return variable === undefined || variable.defs.length === 0;
}

const GROWS = "on every step, so the work grows with the square of the input when the accumulator grows with the input";

function copyMessage(sourceCode: SourceCode, call: ESTree.CallExpression, method: Method, reducer: Reducer): string | undefined {
  const name = reducer.accumulator.name;
  const reads = (node: ESTree.Node): boolean => readsAccumulator(sourceCode, node, reducer.accumulator, new Set());
  const [first, ...rest] = call.arguments;
  if (method.name === "assign" && isGlobal(sourceCode, method.object, "Object")) {
    if (first === undefined || unwrap(first).type !== "ObjectExpression" || !rest.some(reads)) return undefined;
    return `\`Object.assign\` into a new object copies the reduce accumulator \`${name}\` ${GROWS}. Assign into the accumulator, as in \`Object.assign(${name}, item)\`, and return it.`;
  }
  if (method.name === "from" && isGlobal(sourceCode, method.object, "Array")) {
    if (first === undefined || !reads(first)) return undefined;
    return `\`Array.from\` copies the reduce accumulator \`${name}\` ${GROWS}. Push into the accumulator and return it.`;
  }
  if (!ARRAY_COPIES.has(method.name) || reducer.initialValue === undefined) return undefined;
  if (!isKnownArray(sourceCode, reducer.initialValue, new Set()) || !reads(method.object)) return undefined;
  return `\`.${method.name}()\` copies the reduce accumulator \`${name}\` ${GROWS}. Change the accumulator in place, as with \`push\`, and return it.`;
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Refuse a reduce callback that copies its accumulator with Object.assign, Array.from or an array copy method" },
  },
  create(context) {
    return {
      CallExpression: (node) => {
        const method = methodOf(node.callee);
        if (method === undefined) return;
        const reducer = enclosingReducer(context.sourceCode, node);
        if (reducer === undefined) return;
        const message = copyMessage(context.sourceCode, node, method, reducer);
        if (message !== undefined) context.report({ node, message });
      },
    };
  },
};

export default rule;
