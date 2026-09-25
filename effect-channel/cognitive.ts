import type {
  Arrow,
  CallLike,
  Control,
  FunctionKind,
  If,
  Loop,
  NamedFunction,
  Static,
  SyntaxNode,
} from "./cognitive-nodes.ts";
import {
  isCall,
  isControl,
  isFunction,
  isLoop,
  isPlainA,
  isPlainB,
  isPlainC,
  plainChildrenA,
  plainChildrenB,
  plainChildrenC,
} from "./cognitive-plain.ts";


export type SelfNames = { readonly identifiers: readonly string[]; readonly members: readonly string[] };

type State = { total: number; recursive: boolean; names: SelfNames };

function unreachable(_value: never): void {}

function scoreList(state: State, nodes: readonly (SyntaxNode | null)[], nesting: number, parent: SyntaxNode | null, nested: boolean): void {
  for (const node of nodes) {
    if (node !== null) score(state, node, nesting, parent, nested);
  }
}

function score(state: State, node: SyntaxNode, nesting: number, parent: SyntaxNode | null, nested: boolean): void {
  if (isControl(node)) return scoreControl(state, node, nesting, nested);
  if (isLoop(node)) return scoreLoop(state, node, nesting, nested);
  if (isCall(node)) return scoreCall(state, node, nesting, parent, nested);
  if (isFunction(node)) return scoreFunction(state, node, nesting);
  if (isPlainA(node)) return scoreList(state, plainChildrenA(node), nesting, node, nested);
  if (isPlainB(node)) return scoreList(state, plainChildrenB(node), nesting, node, nested);
  if (isPlainC(node)) return scoreList(state, plainChildrenC(node), nesting, node, nested);
}


function scoreBranch(state: State, node: If, nesting: number, nested: boolean): void {
  score(state, node.test, nesting, node, nested);
  score(state, node.consequent, nesting + 1, node, nested);
  const alternate = node.alternate;
  if (alternate === null) return;
  state.total += 1;
  if (alternate.type === "IfStatement") return scoreBranch(state, alternate, nesting, nested);
  score(state, alternate, nesting + 1, node, nested);
}

function scoreIf(state: State, node: If, nesting: number, nested: boolean): void {
  state.total += 1 + nesting;
  scoreBranch(state, node, nesting, nested);
}

function scoreControl(state: State, node: Control, nesting: number, nested: boolean): void {
  switch (node.type) {
    case "IfStatement": {
      return scoreIf(state, node, nesting, nested);
    }
    case "ConditionalExpression": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node, nested);
      score(state, node.consequent, nesting + 1, node, nested);
      score(state, node.alternate, nesting + 1, node, nested);
      return;
    }
    case "SwitchStatement": {
      state.total += 1 + nesting;
      score(state, node.discriminant, nesting, node, nested);
      scoreList(state, node.cases, nesting + 1, node, nested);
      return;
    }
    case "SwitchCase": {
      if (node.test !== null) score(state, node.test, nesting, node, nested);
      scoreList(state, node.consequent, nesting, node, nested);
      return;
    }
    case "TryStatement": {
      score(state, node.block, nesting, node, nested);
      if (node.handler !== null) score(state, node.handler, nesting, node, nested);
      if (node.finalizer !== null) score(state, node.finalizer, nesting, node, nested);
      return;
    }
    case "CatchClause": {
      state.total += 1 + nesting;
      if (node.param !== null) score(state, node.param, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    default: {
      return unreachable(node);
    }
  }
}

function scoreLoop(state: State, node: Loop, nesting: number, nested: boolean): void {
  switch (node.type) {
    case "ForStatement": {
      state.total += 1 + nesting;
      if (node.init !== null) score(state, node.init, nesting, node, nested);
      if (node.test !== null) score(state, node.test, nesting, node, nested);
      if (node.update !== null) score(state, node.update, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "ForInStatement":
    case "ForOfStatement": {
      state.total += 1 + nesting;
      score(state, node.left, nesting, node, nested);
      score(state, node.right, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "WhileStatement": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "DoWhileStatement": {
      state.total += 1 + nesting;
      score(state, node.body, nesting + 1, node, nested);
      score(state, node.test, nesting, node, nested);
      return;
    }
    case "LabeledStatement": {
      score(state, node.body, nesting, node, nested);
      return;
    }
    default: {
      return unreachable(node);
    }
  }
}

function insideRun(parent: SyntaxNode | null): boolean {
  return parent !== null && parent.type === "LogicalExpression" && (parent.operator === "&&" || parent.operator === "||");
}

function countRuns(node: SyntaxNode, parentOperator: string | null): number {
  if (node.type !== "LogicalExpression") return 0;
  if (node.operator !== "&&" && node.operator !== "||") return 0;
  const own = node.operator === parentOperator ? 0 : 1;
  return own + countRuns(node.left, node.operator) + countRuns(node.right, node.operator);
}

function isSelfCall(state: State, callee: SyntaxNode): boolean {
  if (callee.type === "Identifier") return state.names.identifiers.includes(callee.name);
  if (callee.type === "MemberExpression" && callee.object.type === "ThisExpression" && callee.property.type === "Identifier") {
    return state.names.members.includes(callee.property.name);
  }
  return false;
}

function scoreCall(state: State, node: CallLike, nesting: number, parent: SyntaxNode | null, nested: boolean): void {
  switch (node.type) {
    case "LogicalExpression": {
      if (!insideRun(parent) && (node.operator === "&&" || node.operator === "||")) state.total += countRuns(node, null);
      score(state, node.left, nesting, node, nested);
      score(state, node.right, nesting, node, nested);
      return;
    }
    case "BreakStatement":
    case "ContinueStatement": {
      if (node.label !== null) state.total += 1;
      return;
    }
    case "CallExpression":
    case "NewExpression": {
      if (!nested && isSelfCall(state, node.callee)) state.recursive = true;
      score(state, node.callee, nesting, node, nested);
      scoreList(state, node.arguments, nesting, node, nested);
      return;
    }
    case "ImportExpression": {
      score(state, node.source, nesting, node, nested);
      if (node.options !== null) score(state, node.options, nesting, node, nested);
      return;
    }
    default: {
      return unreachable(node);
    }
  }
}

function scoreFunction(state: State, node: FunctionKind, nesting: number): void {
  switch (node.type) {
    case "ArrowFunctionExpression": {
      scoreList(state, node.params, nesting + 1, node, true);
      score(state, node.body, nesting + 1, node, true);
      return;
    }
    case "StaticBlock": {
      scoreList(state, node.body, nesting + 1, node, true);
      return;
    }
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression": {
      scoreList(state, node.params, nesting + 1, node, true);
      if (node.body !== null) score(state, node.body, nesting + 1, node, true);
      return;
    }
    default: {
      return unreachable(node);
    }
  }
}

export function cognitiveComplexity(root: NamedFunction | Arrow | Static, names: SelfNames): number {
  const state: State = { total: 0, recursive: false, names };
  if (root.type === "StaticBlock") {
    scoreList(state, root.body, 0, root, false);
    return state.total;
  }
  scoreList(state, root.params, 0, root, false);
  if (root.type === "ArrowFunctionExpression") score(state, root.body, 0, root, false);
  else if (root.body !== null) score(state, root.body, 0, root, false);
  return state.recursive ? state.total + 1 : state.total;
}
